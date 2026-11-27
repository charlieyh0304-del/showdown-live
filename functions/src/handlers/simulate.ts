/**
 * 경기 시뮬레이션 핸들러 (simulate_matches)
 * - lightweight 모드: 간단한 scoreHistory + 빠른 점수 생성
 * - 일반 모드: 코인토스/서브/타임아웃/사이드체인지 등 포인트 단위 진행
 * - 예선 완료 시 결승 자동 생성/시뮬레이션 지원 (executeTool 콜백)
 */
import { db, asString, asBoolean } from "../db-helpers";
import { resolveScoringRules, sweepAdvancement, walkoverSetsForTournament, type MatchData as AdvMatchData } from "../lib/advancement";
import { matchWinnerByRules, resolveMatchScoring, setWinnerByRules } from "../shared/rules/competitionRules";
import { matchDecidedBy, timeLimitOf } from "../shared/rules/timeLimit";
import { simulateTimeExpiry, type SimSet } from "../lib/sim-time-limit";
import { playersOnCourtOf, servesPerTurnOf, sideChangePointOf } from "../shared/rules/serve";

type ExecuteTool = (name: string, input: Record<string, unknown>) => Promise<string>;

type MatchData = Record<string, unknown>;
type TeamObj = { memberNames?: string[]; coachName?: string };

/** team1/team2 중첩 객체 안전 접근 */
function getTeamObj(match: MatchData, side: 1 | 2): TeamObj | undefined {
  return match[`team${side}`] as TeamObj | undefined;
}
function getMembers(match: MatchData, side: 1 | 2): string[] {
  return getTeamObj(match, side)?.memberNames || [];
}
function getCoach(match: MatchData, side: 1 | 2): string {
  return getTeamObj(match, side)?.coachName || asString(match[`player${side}Coach`]);
}
/** player{side}Id || team{side}Id (둘 중 비어있지 않은 쪽) */
function getSideId(match: MatchData, side: 1 | 2): string {
  return asString(match[`player${side}Id`]) || asString(match[`team${side}Id`]);
}
/** 표시용 이름: 팀전이면 team→player 순, 개인전이면 player→team 순 */
function getSideName(match: MatchData, side: 1 | 2, isTeam: boolean): string {
  const playerName = asString(match[`player${side}Name`]);
  const teamName = asString(match[`team${side}Name`]);
  const fallback = `P${side}`;
  if (isTeam) return teamName || playerName || fallback;
  return playerName || teamName || fallback;
}

/**
 * sourceMatch1/2 링크로 다음 경기에 승자/패자를 배치하는 multi-path update.
 * 실경기 트리거(advanceOnMatchResult)와 같은 lib/advancement 로직을 쓴다:
 * BYE는 패자 슬롯(3/4위전)에 들어가지 않고, 관리자가 직접 넣은 슬롯은 덮어쓰지 않는다.
 */
function buildAdvanceBulk(
  tid: string, allM: Record<string, AdvMatchData>, tourData: Record<string, unknown>,
): { bulk: Record<string, unknown>; count: number } {
  const patches = sweepAdvancement(allM, m => resolveScoringRules(m, tourData), walkoverSetsForTournament(tourData));
  const bulk: Record<string, unknown> = {};
  for (const [nextId, patch] of Object.entries(patches)) {
    for (const [field, value] of Object.entries(patch)) bulk[`matches/${tid}/${nextId}/${field}`] = value;
  }
  return { bulk, count: Object.keys(patches).length };
}

export async function simulateMatches(input: Record<string, unknown>, executeTool: ExecuteTool): Promise<string> {
  const tid = asString(input.tournamentId);
  const now = Date.now();
  const stageId = input.stageId ? asString(input.stageId) : undefined;
  const groupId = input.groupId ? asString(input.groupId) : undefined;
  const lightweight = asBoolean(input.lightweight); // scoreHistory 스킵

  // 대회 설정에서 세트 수/점수 자동 로드
  const tourSnap = await db.ref(`tournaments/${tid}`).once("value");
  const tourData = tourSnap.exists() ? tourSnap.val() as Record<string, unknown> : {};
  const isTeamType = tourData.type === "team" || tourData.type === "randomTeamLeague";
  // 경기 점수 규칙은 경기마다 대회 규칙 단일 설정원에서 읽는다 (resolveMatchScoring:
  // 경기 → 순위결정전/라운드별 → 스테이지 → 대회 → 레거시 필드 → 기본). 입력 winScore/setsToWin/timeLimitSeconds는 시뮬레이션 전용 덮어쓰기.
  const inputWinScore = typeof input.winScore === "number" && input.winScore > 0 ? input.winScore : undefined;
  const inputSetsToWin = typeof input.setsToWin === "number" && input.setsToWin > 0 ? input.setsToWin : undefined;
  const inputTimeLimit = typeof input.timeLimitSeconds === "number" && input.timeLimitSeconds >= 0 ? input.timeLimitSeconds : undefined;

  const matchesSnap = await db.ref(`matches/${tid}`).once("value");
  if (!matchesSnap.exists()) return JSON.stringify({ error: "경기가 없습니다." });

  let matchList = Object.entries(matchesSnap.val() as Record<string, Record<string, unknown>>);
  matchList = matchList.filter(([, m]) => m.status === "pending");
  if (stageId) matchList = matchList.filter(([, m]) => m.stageId === stageId);
  if (groupId) matchList = matchList.filter(([, m]) => m.groupId === groupId);

  // 선수가 없는 경기(빈 슬롯) 제외
  matchList = matchList.filter(([, m]) => {
    const p1 = getSideId(m, 1);
    const p2 = getSideId(m, 2);
    return p1 && p2;
  });

  if (matchList.length === 0) {
    // 시뮬레이션할 경기가 없어도 BYE 경기 승자 전파 시도
    const byeSnap = await db.ref(`matches/${tid}`).once("value");
    if (byeSnap.exists()) {
      const { bulk: advanceBulk, count: advanceCount } = buildAdvanceBulk(tid, byeSnap.val() as Record<string, AdvMatchData>, tourData);
      if (Object.keys(advanceBulk).length > 0) {
        await db.ref().update(advanceBulk);
        return JSON.stringify({ success: true, count: 0, message: `BYE 승자 ${advanceCount}건 전파 완료` });
      }
    }
    return JSON.stringify({ success: true, count: 0, message: "시뮬레이션할 경기 없음" });
  }

  const bulk: Record<string, unknown> = {};
  const results: Array<{ match: string; score: string; winner: string }> = [];

  for (const [mid, match] of matchList) {
    const resolved = resolveMatchScoring({ ...match, type: isTeamType ? "team" : match.type }, tourData);
    const rules = {
      ...resolved,
      ...(inputWinScore ? { winScore: Math.max(4, inputWinScore) } : {}),
      ...(inputSetsToWin ? { setsToWin: inputSetsToWin, maxSets: inputSetsToWin * 2 - 1 } : {}),
    };
    const matchSetsToWin = rules.setsToWin;
    const timeLimitSeconds = Math.max(0, inputTimeLimit ?? rules.timeLimitSeconds ?? 0);
    // 시간 제한 (M0f): 랠리 시간만 센다(사이드 체인지·타임아웃 제외). per_set이면 세트마다 새로 잰다.
    const timedRules = { ...rules, timeLimitSeconds: timeLimitSeconds || undefined };
    const timeCfg = timeLimitOf(timedRules);
    const kind = isTeamType || match.type === "team" ? "team" as const : "individual" as const;

    const sets: SimSet[] = [];
    const p1Id3 = getSideId(match, 1);
    const p2Id3 = getSideId(match, 2);

    // lightweight 모드: 간단한 scoreHistory + 세트 점수 빠르게 생성
    // 득점 이벤트만 기록 (서브/타임아웃 등은 스킵)
    if (lightweight) {
      const lwP1n = asString(match.player1Name) || asString(match.team1Name) || "P1";
      const lwP2n = asString(match.player2Name) || asString(match.team2Name) || "P2";
      const lwHistory: Array<Record<string, unknown>> = [];
      let lwTime = Date.now();
      const lwFmt = (ms: number) => {
        const d = new Date(ms);
        const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
        return `${String(kst.getUTCHours()).padStart(2, "0")}:${String(kst.getUTCMinutes()).padStart(2, "0")}`;
      };
      // 매치 시작 이벤트
      lwHistory.push({
        time: lwFmt(lwTime), set: 1, scoringPlayer: "", actionPlayer: "",
        actionType: "match_start", actionLabel: "경기 시작", points: 0,
        server: "", serveNumber: 0, serverSide: "",
      });

      let lwTimeUp = false; // 경기가 시간 제한으로 끝났다
      let lwPlayMs = 0;     // 시계가 잰 플레이 시간 (랠리만)
      let lw1 = 0, lw2 = 0;
      let lwSi = 0;
      while (lw1 < matchSetsToWin && lw2 < matchSetsToWin && !lwTimeUp) {
        let s1 = 0, s2 = 0;
        let lwSetDone = false;
        if (timeCfg.unit === "per_set") lwPlayMs = 0;
        if (lwSi > 0) {
          lwTime += 30000;
          lwHistory.push({
            time: lwFmt(lwTime), set: lwSi + 1, scoringPlayer: "", actionPlayer: "",
            actionType: "side_change", actionLabel: `세트${lwSi + 1} 시작`, points: 0,
            server: "", serveNumber: 0,
            scoreBefore: { player1: 0, player2: 0 }, scoreAfter: { player1: 0, player2: 0 }, serverSide: "",
          });
        }
        while (true) {
          const isGoal = Math.random() < 0.7;
          const pts = isGoal ? 2 : 1;
          const p1Scores = Math.random() > 0.5;
          const prev1 = s1, prev2 = s2;
          if (p1Scores) s1 += pts; else s2 += pts;
          const lwRally = 15000 + Math.floor(Math.random() * 10000);
          lwTime += lwRally;
          lwPlayMs += lwRally;
          const scorer = p1Scores ? lwP1n : lwP2n;
          const fouler = p1Scores ? lwP2n : lwP1n;
          lwHistory.push({
            time: lwFmt(lwTime), set: lwSi + 1,
            scoringPlayer: scorer,
            actionPlayer: isGoal ? scorer : fouler,
            actionType: isGoal ? "goal" : "foul",
            actionLabel: isGoal ? `${scorer} 골 득점` : `${fouler} foul`,
            points: pts,
            server: "", serveNumber: 0,
            scoreBefore: { player1: prev1, player2: prev2 },
            scoreAfter: { player1: s1, player2: s2 },
            serverSide: "",
          });
          if (setWinnerByRules(s1, s2, rules)) break;
          // 시간 만료 → 심판 화면과 같은 판정 (앞선 쪽 / 동점이면 골든골)
          if (timeCfg.enabled && lwPlayMs >= timeCfg.limitMs) {
            const ex = simulateTimeExpiry(sets, { player1: s1, player2: s2 }, timedRules, [p1Id3, p2Id3]);
            lwHistory.push({
              time: lwFmt(lwTime), set: lwSi + 1, scoringPlayer: "", actionPlayer: "",
              actionType: "time_expired", actionLabel: `시간 종료 (${Math.round(timeLimitSeconds / 60)}분)`, points: 0,
              server: "", serveNumber: 0,
              scoreBefore: { player1: s1, player2: s2 }, scoreAfter: { player1: s1, player2: s2 }, serverSide: "",
            });
            for (const g of ex.goldenPoints) {
              const gName = g.scorer === 1 ? lwP1n : lwP2n;
              lwHistory.push({
                time: lwFmt(lwTime), set: lwSi + 1, scoringPlayer: gName, actionPlayer: g.goal ? gName : (g.scorer === 1 ? lwP2n : lwP1n),
                actionType: g.goal ? "goal" : "foul", actionLabel: `골든골 ${g.goal ? `${gName} 골` : "foul"}`, points: g.goal ? 2 : 1,
                server: "", serveNumber: 0, scoreBefore: g.before, scoreAfter: g.after, serverSide: "",
              });
            }
            sets.push(ex.set);
            if (ex.set.winnerId === p1Id3) lw1++; else if (ex.set.winnerId === p2Id3) lw2++;
            if (ex.matchOver) lwTimeUp = true;
            lwSetDone = true;
            break;
          }
        }
        if (!lwSetDone) {
          const lwSide = setWinnerByRules(s1, s2, rules);
          sets.push({ player1Score: s1, player2Score: s2, winnerId: lwSide === 2 ? p2Id3 : p1Id3 });
          if (lwSide === 2) lw2++; else lw1++;
        }
        lwSi++;
      }
      // 승자: 규칙 판정 (시간 제한으로 끝난 세트 포함)
      const lwW = matchWinnerByRules(sets, timedRules) ?? (lw1 > lw2 ? 1 : 2);
      const lwWinner = lwW === 1 ? p1Id3 : p2Id3;
      const lwWinnerName = lwW === 1 ? lwP1n : lwP2n;
      const lwScore = sets.map(s => `${s.player1Score}-${s.player2Score}`).join(", ");
      results.push({ match: `${match.player1Name || match.team1Name} vs ${match.player2Name || match.team2Name}`, score: lwScore, winner: lwWinnerName });
      bulk[`matches/${tid}/${mid}/sets`] = sets;
      bulk[`matches/${tid}/${mid}/currentSet`] = sets.length - 1;
      bulk[`matches/${tid}/${mid}/status`] = "completed";
      bulk[`matches/${tid}/${mid}/winnerId`] = lwWinner;
      bulk[`matches/${tid}/${mid}/scoreHistory`] = lwHistory.reverse(); // newest first (앱 형식과 동일)
      bulk[`matches/${tid}/${mid}/updatedAt`] = now;
      if (timeLimitSeconds > 0) bulk[`matches/${tid}/${mid}/decidedBy`] = matchDecidedBy(sets);
      continue; // 다음 경기로 (간단 scoreHistory 포함)
    }

    // 일반 모드: scoreHistory 포함 포인트 단위 진행

    // scoreHistory 생성 — 득점 과정 시뮬레이션
    const p1n = getSideName(match, 1, isTeamType);
    const p2n = getSideName(match, 2, isTeamType);
    // p1id/p2id는 winnerId에서 이미 사용
    const history: Array<Record<string, unknown>> = [];
    // 경기 예정 시간 기반으로 히스토리 시간 생성 (KST)
    const schedDate = asString(match.scheduledDate, new Date().toISOString().split("T")[0]);
    const schedTime = asString(match.scheduledTime, "09:00");
    const [sh, sm] = schedTime.split(":").map(Number);
    let t = new Date(`${schedDate}T${String(sh).padStart(2, "0")}:${String(sm).padStart(2, "0")}:00+09:00`).getTime();
    const fmt = (ms: number) => {
      const d = new Date(ms);
      const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
      return `${String(kst.getUTCHours()).padStart(2, "0")}:${String(kst.getUTCMinutes()).padStart(2, "0")}`;
    };
    const isTeamMatch = (match.type === "team") || isTeamType;

    // 코인토스: 승자 결정
    const coinTossWinner = Math.random() > 0.5 ? "player1" : "player2";
    const coinTossWinnerName = coinTossWinner === "player1" ? p1n : p2n;
    // 팀전: 코인토스 승자가 서브/리시브 선택 (50% 확률로 시뮬레이션)
    const choosesServe = isTeamMatch ? Math.random() > 0.4 : true; // 팀전: 60% 서브 선택
    const firstServer = choosesServe ? coinTossWinner : (coinTossWinner === "player1" ? "player2" : "player1");
    const choiceLabel = choosesServe ? "서브" : "리시브";

    // 팀전: 라인업 기록 (코인토스 전 — 코인토스 승자가 상대 라인업을 듣고 선택)
    if (isTeamMatch) {
      const t1m = getMembers(match, 1);
      const t2m = getMembers(match, 2);
      const c1 = getCoach(match, 1);
      const c2 = getCoach(match, 2);
      const maxActive = playersOnCourtOf(resolveMatchScoring({ type: "team" }, tourData));
      const fmtLineup = (members: string[]) => {
        const active = members.slice(0, maxActive).map((n, i) => `${i + 1}.${n}`).join(", ");
        const reserve = members.slice(maxActive).map(n => n).join(", ");
        return reserve ? `${active} / 예비: ${reserve}` : active;
      };
      history.push({ time: fmt(t), set: 1, scoringPlayer: "", actionPlayer: "", actionType: "lineup", actionLabel: `${p1n} 라인업: ${fmtLineup(t1m)}${c1 ? ` / 코치: ${c1}` : ""}`, points: 0, server: "", serveNumber: 0, serverSide: "" });
      history.push({ time: fmt(t), set: 1, scoringPlayer: "", actionPlayer: "", actionType: "lineup", actionLabel: `${p2n} 라인업: ${fmtLineup(t2m)}${c2 ? ` / 코치: ${c2}` : ""}`, points: 0, server: "", serveNumber: 0, serverSide: "" });
    }

    // 코인 토스
    history.push({ time: fmt(t), set: 1, scoringPlayer: "", actionPlayer: "", actionType: "coin_toss", actionLabel: `코인 토스: ${coinTossWinnerName} 승리 → ${choiceLabel} 선택`, points: 0, server: "", serveNumber: 0, serverSide: firstServer });
    t += 30000;

    // 워밍업
    history.push({ time: fmt(t), set: 1, scoringPlayer: "", actionPlayer: "", actionType: "warmup_start", actionLabel: "워밍업 (60초)", points: 0, server: "", serveNumber: 0, serverSide: "" });
    t += 60000;

    // 경기 시작
    history.push({ time: fmt(t), set: 1, scoringPlayer: "", actionPlayer: "", actionType: "match_start", actionLabel: `경기 시작`, points: 0, server: "", serveNumber: 0, serverSide: firstServer });
    const sideChangePoint = sideChangePointOf(rules);
    const maxServesPerPerson = servesPerTurnOf(rules, kind);
    const onCourt = playersOnCourtOf(rules);
    let serveCount = 0;
    let currentServer = firstServer;
    let serveNum = 1;

    // 팀전: 팀원 이름 순환 (memberNames 배열 사용)
    const team1Members = getTeamObj(match, 1)?.memberNames;
    const team2Members = getTeamObj(match, 2)?.memberNames;
    let p1MemberIdx = 0; // player1(team1) 쪽 현재 서브하는 팀원 인덱스
    let p2MemberIdx = 0; // player2(team2) 쪽 현재 서브하는 팀원 인덱스

    // 서브 표시: 팀전이면 "전남 1번째 서브", 개인전이면 "선수명"
    const getServerLabel = () => {
      const teamName = currentServer === "player1" ? p1n : p2n;
      if (isTeamMatch) {
        return `${teamName} ${serveNum}번째 서브`;
      }
      return `${teamName} ${serveNum}번째 서브`;
    };

    // 세트를 사전 생성하지 않고 포인트 단위로 직접 진행
    let p1SetWins = 0, p2SetWins = 0;
    let si = 0;
    // 시간 제한 (M0f): 랠리 시간만 센다 (사이드 체인지·타임아웃 제외). per_set이면 세트마다 새로 잰다.
    let playMs = 0;
    let timeUp = false;
    while (p1SetWins < matchSetsToWin && p2SetWins < matchSetsToWin && !timeUp) {
      let sc1 = 0, sc2 = 0;
      let setDone = false;
      if (timeCfg.unit === "per_set") playMs = 0;
      let sideChanged = false;
      let timeoutUsed1 = false, timeoutUsed2 = false;

      // 세트 시작 (2세트부터 사이드 체인지 + 서브 교대)
      if (si > 0) {
        currentServer = currentServer === "player1" ? "player2" : "player1";
        serveCount = 0;
        serveNum = 1;
        t += 30000;
        history.push({ time: fmt(t), set: si + 1, scoringPlayer: "", actionPlayer: "", actionType: "side_change", actionLabel: `세트${si + 1} 시작 — 사이드 체인지`, points: 0, server: getServerLabel(), serveNumber: 1, scoreBefore: { player1: 0, player2: 0 }, scoreAfter: { player1: 0, player2: 0 }, serverSide: currentServer });
      }

      // 결정 세트(단판 포함)에서만 세트 중 사이드 체인지 (그 외 세트는 세트 뒤에 바꾼다, IBSA)
      const isDecidingSet = p1SetWins === matchSetsToWin - 1 && p2SetWins === matchSetsToWin - 1;
      const doSideChange = isDecidingSet;

      while (true) {
        // 세트 종료 조건: 대회 규칙(목표 점수·점수 차·듀스 캡)
        if (setWinnerByRules(sc1, sc2, rules)) break;
        const rally = 10000 + Math.floor(Math.random() * 20000);
        t += rally;
        playMs += rally;

        // 사이드 체인지: 결정 세트에서 규칙의 사이드 체인지 점수 (기본 ceil(목표/2): 11점 → 6, 31점 → 16)
        const maxScNow = Math.max(sc1, sc2);
        if (doSideChange && !sideChanged && maxScNow >= sideChangePoint) {
          sideChanged = true;
          t += 60000;
          history.push({ time: fmt(t), set: si + 1, scoringPlayer: "", actionPlayer: "", actionType: "side_change", actionLabel: `사이드 체인지 (${sideChangePoint}점)`, points: 0, server: "", serveNumber: 0, scoreBefore: { player1: sc1, player2: sc2 }, scoreAfter: { player1: sc1, player2: sc2 }, serverSide: currentServer });
        }

        // 타임아웃
        const maxSc = Math.max(sc1, sc2);
        if (maxSc >= 10 && Math.random() < 0.08) {
          if (!timeoutUsed1 && Math.random() > 0.5) {
            timeoutUsed1 = true;
            t += 60000;
            history.push({ time: fmt(t), set: si + 1, scoringPlayer: "", actionPlayer: p1n, actionType: "timeout_player", actionLabel: `${p1n} 타임아웃`, points: 0, server: "", serveNumber: 0, scoreBefore: { player1: sc1, player2: sc2 }, scoreAfter: { player1: sc1, player2: sc2 }, serverSide: currentServer });
          } else if (!timeoutUsed2) {
            timeoutUsed2 = true;
            t += 60000;
            history.push({ time: fmt(t), set: si + 1, scoringPlayer: "", actionPlayer: p2n, actionType: "timeout_player", actionLabel: `${p2n} 타임아웃`, points: 0, server: "", serveNumber: 0, scoreBefore: { player1: sc1, player2: sc2 }, scoreAfter: { player1: sc1, player2: sc2 }, serverSide: currentServer });
          }
        }

        // 1. 서브 번호 + 라벨 캡처
        serveNum = serveCount + 1;
        const currentServeLabel = getServerLabel();

        // 2. 서브 이벤트 기록 (별도 행으로)
        const serverTeam = currentServer === "player1" ? p1n : p2n;
        const receiverTeam = currentServer === "player1" ? p2n : p1n;
        // 점수는 항상 player1=player1 실제 점수, player2=player2 실제 점수로 저장
        history.push({ time: fmt(t), set: si + 1, scoringPlayer: "", actionPlayer: "", actionType: "serve", actionLabel: currentServeLabel, points: 0, server: currentServeLabel, serveNumber: serveNum, scoreBefore: { player1: sc1, player2: sc2 }, scoreAfter: { player1: sc1, player2: sc2 }, serverSide: currentServer, serverName: serverTeam, receiverName: receiverTeam });

        // 3. 득점 (IBSA: 골=+2 득점자에게, 파울=+1 상대에게)
        const prevSc1 = sc1, prevSc2 = sc2;
        const p1Turn = Math.random() > 0.5;
        const isGoal = Math.random() < 0.7;
        if (isGoal) {
          // 골: +2 득점자에게
          if (p1Turn) { sc1 += 2; } else { sc2 += 2; }
        } else {
          // 파울: +1 상대에게
          if (p1Turn) { sc1 += 1; } else { sc2 += 1; }
        }
        // (세트 종료는 루프 상단에서 체크)
        const actualPts = p1Turn ? (sc1 - prevSc1) : (sc2 - prevSc2);
        // 골: scorer=득점자, actionPlayer=득점자
        // 파울: scorer=점수받는자(p1Turn), actionPlayer=상대(파울한자)
        const scorerName = p1Turn ? p1n : p2n;
        const foulerName = p1Turn ? p2n : p1n; // 파울한 선수 = 상대

        // 4. 득점 기록
        if (isGoal) {
          history.push({ time: fmt(t), set: si + 1, scoringPlayer: scorerName, actionPlayer: scorerName, actionType: "goal", actionLabel: `${scorerName} 골 득점`, points: actualPts, server: currentServeLabel, serveNumber: serveNum, scoreBefore: { player1: prevSc1, player2: prevSc2 }, scoreAfter: { player1: sc1, player2: sc2 }, serverSide: currentServer });
        } else {
          history.push({ time: fmt(t), set: si + 1, scoringPlayer: scorerName, actionPlayer: foulerName, actionType: "foul", actionLabel: `${foulerName} foul`, points: actualPts, server: currentServeLabel, serveNumber: serveNum, scoreBefore: { player1: prevSc1, player2: prevSc2 }, scoreAfter: { player1: sc1, player2: sc2 }, serverSide: currentServer });
        }

        // 시간 만료 → 심판 화면과 같은 판정 (앞선 쪽이 세트/경기, 동점이면 골든골)
        if (timeCfg.enabled && playMs >= timeCfg.limitMs && !setWinnerByRules(sc1, sc2, rules)) {
          const ex = simulateTimeExpiry(sets, { player1: sc1, player2: sc2 }, timedRules, [p1Id3, p2Id3]);
          history.push({
            time: fmt(t), set: si + 1, scoringPlayer: "", actionPlayer: "",
            actionType: "time_expired", actionLabel: `시간 종료 (${Math.round(timeLimitSeconds / 60)}분)`, points: 0,
            server: "", serveNumber: 0,
            scoreBefore: { player1: sc1, player2: sc2 }, scoreAfter: { player1: sc1, player2: sc2 }, serverSide: currentServer,
          });
          for (const g of ex.goldenPoints) {
            const gName = g.scorer === 1 ? p1n : p2n;
            history.push({
              time: fmt(t), set: si + 1, scoringPlayer: gName, actionPlayer: g.goal ? gName : (g.scorer === 1 ? p2n : p1n),
              actionType: g.goal ? "goal" : "foul", actionLabel: `골든골 ${g.goal ? `${gName} 골 득점` : "foul"}`, points: g.goal ? 2 : 1,
              server: "", serveNumber: 0, scoreBefore: g.before, scoreAfter: g.after, serverSide: currentServer,
            });
          }
          sets.push(ex.set);
          if (ex.set.winnerId === p1Id3) p1SetWins++; else if (ex.set.winnerId === p2Id3) p2SetWins++;
          if (ex.matchOver) timeUp = true;
          setDone = true;
          break;
        }

        // 5. 서브 카운트 증가 + 서버 교대 + 팀전 선수 교체
        serveCount++;
        if (serveCount >= maxServesPerPerson) {
          serveCount = 0;
          serveNum = 0;

          // 팀전: 서브 3번 끝낸 팀이 선수 교체
          if (isTeamMatch) {
            const servingTeam = currentServer;
            const servingTeamName = servingTeam === "player1" ? p1n : p2n;
            if (servingTeam === "player1" && team1Members && team1Members.length > 0) {
              p1MemberIdx = (p1MemberIdx + 1) % Math.min(onCourt, team1Members.length);
            } else if (servingTeam === "player2" && team2Members && team2Members.length > 0) {
              p2MemberIdx = (p2MemberIdx + 1) % Math.min(onCourt, team2Members.length);
            }
            history.push({ time: fmt(t), set: si + 1, scoringPlayer: "", actionPlayer: servingTeamName, actionType: "substitution", actionLabel: `${servingTeamName} 선수 교체`, points: 0, server: "", serveNumber: 0, scoreBefore: { player1: sc1, player2: sc2 }, scoreAfter: { player1: sc1, player2: sc2 }, serverSide: currentServer });
          }

          // 서버 교대
          currentServer = currentServer === "player1" ? "player2" : "player1";
        }
        if (history.length > 120) break;
      }

      // 세트 종료 → 결과 저장 (시간 제한으로 끝난 세트는 위에서 저장했다)
      if (!setDone) {
        const setSide = setWinnerByRules(sc1, sc2, rules);
        sets.push({ player1Score: sc1, player2Score: sc2, winnerId: setSide === 2 ? p2Id3 : p1Id3 });
        if (setSide === 2) p2SetWins++; else p1SetWins++;
      }
      si++;
    }

    // 승자 결정: 규칙 판정 (시간 제한으로 끝난 세트 포함)
    const finalW = matchWinnerByRules(sets, timedRules) ?? (p1SetWins > p2SetWins ? 1 : 2);
    const finalWinnerId = finalW === 1 ? p1Id3 : p2Id3;
    const winnerName = getSideName(match, finalW, false);
    const scoreStr = sets.map(s => `${s.player1Score}-${s.player2Score}`).join(", ");
    results.push({ match: `${match.player1Name || match.team1Name} vs ${match.player2Name || match.team2Name}`, score: scoreStr, winner: winnerName });

    bulk[`matches/${tid}/${mid}/sets`] = sets;
    bulk[`matches/${tid}/${mid}/currentSet`] = sets.length - 1;
    bulk[`matches/${tid}/${mid}/status`] = "completed";
    bulk[`matches/${tid}/${mid}/winnerId`] = finalWinnerId;
    bulk[`matches/${tid}/${mid}/coinTossWinner`] = coinTossWinner;
    bulk[`matches/${tid}/${mid}/coinTossChoice`] = choosesServe ? "serve" : "receive";
    bulk[`matches/${tid}/${mid}/scoreHistory`] = history.reverse(); // newest first (앱 형식과 동일)
    bulk[`matches/${tid}/${mid}/updatedAt`] = now;
    if (timeLimitSeconds > 0) bulk[`matches/${tid}/${mid}/decidedBy`] = matchDecidedBy(sets);

    // 서브 기준 점수로 결과 업데이트
    const serverScoreStr = sets.map((s, si) => {
      const setServer = si % 2 === 0 ? firstServer : (firstServer === "player1" ? "player2" : "player1");
      const srvScore = setServer === "player1" ? s.player1Score : s.player2Score;
      const rcvScore = setServer === "player1" ? s.player2Score : s.player1Score;
      return `${srvScore}-${rcvScore}`;
    }).join(", ");
    // 결과의 score를 서브 기준으로 갱신
    const lastResult = results[results.length - 1];
    if (lastResult) lastResult.score = serverScoreStr;
  }

  await db.ref().update(bulk);

  // 승자 자동 진출: sourceMatch1/2를 참조하는 다음 라운드 경기에 승자 배치
  const refreshSnap = await db.ref(`matches/${tid}`).once("value");
  if (refreshSnap.exists()) {
    const { bulk: advanceBulk, count: advanceCount } = buildAdvanceBulk(tid, refreshSnap.val() as Record<string, AdvMatchData>, tourData);

    if (Object.keys(advanceBulk).length > 0) {
      await db.ref().update(advanceBulk);
      results.push({ match: "자동 진출", score: "", winner: `${advanceCount}경기에 승자/패자 배치 완료` });
    }
  }

  // 대회/스테이지 상태 자동 업데이트
  if (!lightweight) await new Promise(r => setTimeout(r, 500)); // lightweight는 대기 불필요
  const statusSnap = await db.ref(`matches/${tid}`).once("value");
  if (statusSnap.exists()) {
    const allMatches = Object.values(statusSnap.val() as Record<string, Record<string, unknown>>);
    const allCompleted = allMatches.every(m => m.status === "completed");
    const anyInProgress = allMatches.some(m => m.status === "in_progress");
    const statusBulk: Record<string, unknown> = {};

    // 대회 상태: 모두 완료 → completed, 진행 중 있으면 in_progress
    if (allCompleted) {
      statusBulk[`tournaments/${tid}/status`] = "completed";
    } else if (anyInProgress || allMatches.some(m => m.status === "completed")) {
      statusBulk[`tournaments/${tid}/status`] = "in_progress";
    }

    // 스테이지 상태: 해당 스테이지의 경기가 모두 완료되면 completed
    const tourStages = tourData.stages as Array<{ id: string }> | undefined;
    if (tourStages) {
      for (const stage of tourStages) {
        if (!stage.id) continue;
        const stageMatches = allMatches.filter(m => m.stageId === stage.id);
        if (stageMatches.length > 0 && stageMatches.every(m => m.status === "completed")) {
          statusBulk[`tournaments/${tid}/stages/${tourStages.indexOf(stage)}/status`] = "completed";
        } else if (stageMatches.some(m => m.status === "completed" || m.status === "in_progress")) {
          statusBulk[`tournaments/${tid}/stages/${tourStages.indexOf(stage)}/status`] = "in_progress";
        }
      }
    }

    if (Object.keys(statusBulk).length > 0) await db.ref().update(statusBulk);

    // 예선 완료 시 결승 자동 생성 + 시뮬레이션 (풀리그는 결승 없음)
    // skipAutoGenerate가 true이면 건너뜀 (run_full_simulation에서 직접 처리)
    const skipAutoGen = asBoolean(input.skipAutoGenerate);
    const tourFormat = asString(tourData.format);
    const isFullLeagueFormat = tourFormat === "full_league" || tourData.formatType === "round_robin";
    if (!isFullLeagueFormat && !skipAutoGen) {
      const tourStagesTyped = tourData.stages as Array<{ id: string; type?: string }> | undefined;
      const qualifyingStage = tourStagesTyped?.find(s => s.type === "qualifying");
      if (qualifyingStage) {
        const qualMatches = allMatches.filter(m => m.stageId === qualifyingStage.id);
        const qualAllDone = qualMatches.length > 0 && qualMatches.every(m => m.status === "completed");
        if (qualAllDone) {
          // 결승이 아직 없는 경우에만 자동 생성
          const finalsExist = allMatches.some(m => {
            const sid = m.stageId ? asString(m.stageId) : undefined;
            return sid && sid.includes("finals");
          });
          if (!finalsExist) {
            // 진출 인원·와일드카드·3/4위전·5~8위전·순위 결정전은 대회 규칙에서 generate_finals가 직접 읽는다 (강제하지 않음)
            const genResult = await executeTool("generate_finals", {
              tournamentId: tid,
              resolveTiesByLot: true,
            });
            const genParsed = JSON.parse(genResult);
            if (genParsed.success) {
              results.push({ match: "결승 자동 생성", score: "", winner: `${genParsed.matchCount}경기 생성` });
              // 결승 경기 시뮬레이션
              const simResult = await executeTool("simulate_matches", { tournamentId: tid, skipAutoGenerate: true });
              const simParsed = JSON.parse(simResult);
              if (simParsed.success) {
                results.push({ match: "결승 시뮬레이션", score: "", winner: `${simParsed.count}경기 완료` });
              }
            }
          }
        }
      }
    }
  }

  // 최종 상태 확인: 모든 경기 완료 시 대회 상태를 completed로
  const finalCheckSnap = await db.ref(`matches/${tid}`).once("value");
  if (finalCheckSnap.exists()) {
    const finalAllMatches = Object.values(finalCheckSnap.val() as Record<string, Record<string, unknown>>);
    const finalAllCompleted = finalAllMatches.every(m => m.status === "completed");
    if (finalAllCompleted) {
      await db.ref(`tournaments/${tid}/status`).set("completed");
    }
  }

  // 팀전이면 팀 멤버/코치 정보를 결과에 포함 (AI가 정확한 이름을 사용하도록)
  let teamInfo: string | undefined;
  if (isTeamType) {
    const teamsSnap = await db.ref(`teams/${tid}`).once("value");
    if (teamsSnap.exists()) {
      const teamsData = teamsSnap.val() as Record<string, { name: string; memberNames?: string[]; coachName?: string }>;
      teamInfo = Object.values(teamsData).map(t => `${t.name}: ${(t.memberNames || []).join(", ")}${t.coachName ? ` (코치: ${t.coachName})` : ""}`).join("\n");
    }
  }

  return JSON.stringify({
    success: true,
    count: matchList.length,
    results: results.slice(0, 10),
    ...(teamInfo ? { teamRoster: teamInfo } : {}),
    message: `${matchList.length}경기 시뮬레이션 완료`,
  });
}
