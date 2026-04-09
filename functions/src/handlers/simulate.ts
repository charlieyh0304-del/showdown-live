/**
 * 경기 시뮬레이션 핸들러 (simulate_matches)
 * - lightweight 모드: 간단한 scoreHistory + 빠른 점수 생성
 * - 일반 모드: 코인토스/서브/타임아웃/사이드체인지 등 포인트 단위 진행
 * - 예선 완료 시 결승 자동 생성/시뮬레이션 지원 (executeTool 콜백)
 */
import { db } from "../db-helpers";

type ExecuteTool = (name: string, input: Record<string, unknown>) => Promise<string>;

export async function simulateMatches(input: Record<string, unknown>, executeTool: ExecuteTool): Promise<string> {
  const tid = input.tournamentId as string;
  const now = Date.now();
  const stageId = input.stageId as string | undefined;
  const groupId = input.groupId as string | undefined;
  const lightweight = (input.lightweight as boolean) || false; // scoreHistory 스킵

  // 대회 설정에서 세트 수/점수 자동 로드
  const tourSnap = await db.ref(`tournaments/${tid}`).once("value");
  const tourData = tourSnap.exists() ? tourSnap.val() as Record<string, unknown> : {};
  const isTeamType = tourData.type === "team" || tourData.type === "randomTeamLeague";
  const teamSettings = tourData.teamMatchSettings as { winScore?: number; setsToWin?: number } | undefined;
  const gameConfig = tourData.gameConfig as { winScore?: number; setsToWin?: number } | undefined;
  const finalsConfig = tourData.finalsConfig as { scoringRules?: { winScore?: number; setsToWin?: number }; roundScoringOverride?: { fromRound?: number; scoringRules?: { winScore?: number; setsToWin?: number } } } | undefined;
  // 예선 기본값
  const baseWinScore = Math.max(4, (input.winScore as number) || (isTeamType ? teamSettings?.winScore : gameConfig?.winScore) || (isTeamType ? 31 : 11));
  const baseSetsToWin = Math.max(1, (input.setsToWin as number) || (isTeamType ? teamSettings?.setsToWin : gameConfig?.setsToWin) || (isTeamType ? 1 : 2));
  // 본선 세트 수 (finalsConfig가 있으면 사용)
  const finalsWinScore = finalsConfig?.scoringRules?.winScore || baseWinScore;
  const finalsSetsToWin = finalsConfig?.scoringRules?.setsToWin || baseSetsToWin;
  // 라운드 오버라이드
  const overrideFromRound = finalsConfig?.roundScoringOverride?.fromRound || 0;
  const overrideSetsToWin = finalsConfig?.roundScoringOverride?.scoringRules?.setsToWin || finalsSetsToWin;
  const overrideWinScore = finalsConfig?.roundScoringOverride?.scoringRules?.winScore || finalsWinScore;

  const matchesSnap = await db.ref(`matches/${tid}`).once("value");
  if (!matchesSnap.exists()) return JSON.stringify({ error: "경기가 없습니다." });

  let matchList = Object.entries(matchesSnap.val() as Record<string, Record<string, unknown>>);
  matchList = matchList.filter(([, m]) => m.status === "pending");
  if (stageId) matchList = matchList.filter(([, m]) => m.stageId === stageId);
  if (groupId) matchList = matchList.filter(([, m]) => m.groupId === groupId);

  // 선수가 없는 경기(빈 슬롯) 제외
  matchList = matchList.filter(([, m]) => {
    const p1 = (m.player1Id || m.team1Id) as string;
    const p2 = (m.player2Id || m.team2Id) as string;
    return p1 && p2 && p1 !== "" && p2 !== "";
  });

  if (matchList.length === 0) {
    // 시뮬레이션할 경기가 없어도 BYE 경기 승자 전파 시도
    const byeSnap = await db.ref(`matches/${tid}`).once("value");
    if (byeSnap.exists()) {
      const allByeM = byeSnap.val() as Record<string, Record<string, unknown>>;
      const advanceBulk: Record<string, unknown> = {};
      let advanceCount = 0;
      for (const [nextId, nextMatch] of Object.entries(allByeM)) {
        if (nextMatch.status !== "pending") continue;
        const src1 = nextMatch.sourceMatch1 as string | undefined;
        const src2 = nextMatch.sourceMatch2 as string | undefined;
        if (!src1 && !src2) continue;
        const isLoser = nextMatch.sourceType === "loser";
        let changed = false;
        if (src1 && allByeM[src1]?.status === "completed" && (!nextMatch.player1Id || nextMatch.player1Id === "")) {
          const srcM = allByeM[src1];
          const wId = srcM.winnerId as string;
          const wName = (wId === (srcM.player1Id || srcM.team1Id) ? (srcM.player1Name || srcM.team1Name) : (srcM.player2Name || srcM.team2Name)) as string;
          const lId = (wId === (srcM.player1Id || srcM.team1Id) ? (srcM.player2Id || srcM.team2Id) : (srcM.player1Id || srcM.team1Id)) as string;
          const lName = (wId === (srcM.player1Id || srcM.team1Id) ? (srcM.player2Name || srcM.team2Name) : (srcM.player1Name || srcM.team1Name)) as string;
          const useId = isLoser ? lId : wId;
          const useName = isLoser ? lName : wName;
          advanceBulk[`matches/${tid}/${nextId}/player1Id`] = useId;
          advanceBulk[`matches/${tid}/${nextId}/player1Name`] = useName;
          advanceBulk[`matches/${tid}/${nextId}/team1Id`] = useId;
          advanceBulk[`matches/${tid}/${nextId}/team1Name`] = useName;
          changed = true;
        }
        if (src2 && allByeM[src2]?.status === "completed" && (!nextMatch.player2Id || nextMatch.player2Id === "")) {
          const srcM = allByeM[src2];
          const wId = srcM.winnerId as string;
          const wName = (wId === (srcM.player1Id || srcM.team1Id) ? (srcM.player1Name || srcM.team1Name) : (srcM.player2Name || srcM.team2Name)) as string;
          const lId = (wId === (srcM.player1Id || srcM.team1Id) ? (srcM.player2Id || srcM.team2Id) : (srcM.player1Id || srcM.team1Id)) as string;
          const lName = (wId === (srcM.player1Id || srcM.team1Id) ? (srcM.player2Name || srcM.team2Name) : (srcM.player1Name || srcM.team1Name)) as string;
          const useId = isLoser ? lId : wId;
          const useName = isLoser ? lName : wName;
          advanceBulk[`matches/${tid}/${nextId}/player2Id`] = useId;
          advanceBulk[`matches/${tid}/${nextId}/player2Name`] = useName;
          advanceBulk[`matches/${tid}/${nextId}/team2Id`] = useId;
          advanceBulk[`matches/${tid}/${nextId}/team2Name`] = useName;
          changed = true;
        }
        if (changed) advanceCount++;
      }
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
    const matchStageId = (match.stageId as string) || "";
    // 본선 브라켓 경기 vs 순위결정전 구분
    const isMainBracket = matchStageId.includes("finals") && !matchStageId.includes("class") && !matchStageId.includes("5to8") && !matchStageId.includes("9to16") && !matchStageId.includes("3rd");
    // 순위결정전은 예선 설정(3세트) 사용
    // 순위결정전 세트 수: rankingMatchConfig.rankingSetsToWin (기본=예선 세트 수)
    const rankingConfig = tourData.rankingMatchConfig as Record<string, unknown> | undefined;
    const rankingSetsToWin = (rankingConfig?.rankingSetsToWin as number) || baseSetsToWin;
    const rankingWinScore = (rankingConfig?.rankingWinScore as number) || baseWinScore;
    // 본선 브라켓: 본선 세트 수 + 오버라이드, 순위결정전: 커스텀 또는 예선 세트 수
    const bracketRoundStr = (match.bracketRound as string) || "";
    const bracketRoundMatch = bracketRoundStr.match(/(\d+)/);
    const bracketRoundNum = bracketRoundMatch ? parseInt(bracketRoundMatch[1]) : (bracketRoundStr === "결승" ? 2 : 0);
    let matchWinScore = isMainBracket ? finalsWinScore : (matchStageId.includes("class") || matchStageId.includes("5to8") || matchStageId.includes("9to16") || matchStageId.includes("3rd") ? rankingWinScore : baseWinScore);
    let matchSetsToWin = isMainBracket ? finalsSetsToWin : (matchStageId.includes("class") || matchStageId.includes("5to8") || matchStageId.includes("9to16") || matchStageId.includes("3rd") ? rankingSetsToWin : baseSetsToWin);
    // 라운드 오버라이드: 본선 브라켓에만 적용
    if (isMainBracket && overrideFromRound > 0 && bracketRoundNum > 0 && bracketRoundNum <= overrideFromRound) {
      matchSetsToWin = overrideSetsToWin;
      matchWinScore = overrideWinScore;
    }

    const sets: Array<{ player1Score: number; player2Score: number; winnerId: string | null }> = [];
    const p1Id3 = (match.player1Id || match.team1Id) as string;
    const p2Id3 = (match.player2Id || match.team2Id) as string;

    // lightweight 모드: 간단한 scoreHistory + 세트 점수 빠르게 생성
    // 득점 이벤트만 기록 (서브/타임아웃 등은 스킵)
    if (lightweight) {
      const lwP1n = (match.player1Name || match.team1Name || "P1") as string;
      const lwP2n = (match.player2Name || match.team2Name || "P2") as string;
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

      let lw1 = 0, lw2 = 0;
      let lwSi = 0;
      while (lw1 < matchSetsToWin && lw2 < matchSetsToWin) {
        let s1 = 0, s2 = 0;
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
          lwTime += 15000 + Math.floor(Math.random() * 10000);
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
          if ((s1 >= matchWinScore || s2 >= matchWinScore) && Math.abs(s1 - s2) >= 2) break;
        }
        const sw = s1 > s2 ? p1Id3 : p2Id3;
        sets.push({ player1Score: s1, player2Score: s2, winnerId: sw });
        if (s1 > s2) lw1++; else lw2++;
        lwSi++;
      }
      const lwWinner = lw1 > lw2 ? p1Id3 : p2Id3;
      const lwWinnerName = lw1 > lw2 ? lwP1n : lwP2n;
      const lwScore = sets.map(s => `${s.player1Score}-${s.player2Score}`).join(", ");
      results.push({ match: `${match.player1Name || match.team1Name} vs ${match.player2Name || match.team2Name}`, score: lwScore, winner: lwWinnerName });
      bulk[`matches/${tid}/${mid}/sets`] = sets;
      bulk[`matches/${tid}/${mid}/currentSet`] = sets.length - 1;
      bulk[`matches/${tid}/${mid}/status`] = "completed";
      bulk[`matches/${tid}/${mid}/winnerId`] = lwWinner;
      bulk[`matches/${tid}/${mid}/scoreHistory`] = lwHistory.reverse(); // newest first (앱 형식과 동일)
      bulk[`matches/${tid}/${mid}/updatedAt`] = now;
      continue; // 다음 경기로 (간단 scoreHistory 포함)
    }

    // 일반 모드: scoreHistory 포함 포인트 단위 진행

    // scoreHistory 생성 — 득점 과정 시뮬레이션
    const p1n = (isTeamType ? (match.team1Name || match.player1Name) : (match.player1Name || match.team1Name) || "P1") as string;
    const p2n = (isTeamType ? (match.team2Name || match.player2Name) : (match.player2Name || match.team2Name) || "P2") as string;
    // p1id/p2id는 winnerId에서 이미 사용
    const history: Array<Record<string, unknown>> = [];
    // 경기 예정 시간 기반으로 히스토리 시간 생성 (KST)
    const schedDate = (match.scheduledDate as string) || new Date().toISOString().split("T")[0];
    const schedTime = (match.scheduledTime as string) || "09:00";
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
      const t1m = ((match.team1 as Record<string, unknown>)?.memberNames as string[]) || [];
      const t2m = ((match.team2 as Record<string, unknown>)?.memberNames as string[]) || [];
      const c1 = (match.team1 as Record<string, unknown>)?.coachName as string || (match.player1Coach as string) || "";
      const c2 = (match.team2 as Record<string, unknown>)?.coachName as string || (match.player2Coach as string) || "";
      const maxActive = 3;
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
    const sideChangePoint = isTeamMatch ? 16 : 6;
    const maxServesPerPerson = isTeamMatch ? 3 : 2;
    let serveCount = 0;
    let currentServer = firstServer;
    let serveNum = 1;

    // 팀전: 팀원 이름 순환 (memberNames 배열 사용)
    const team1Members = (match.team1 as Record<string, unknown>)?.memberNames as string[] | undefined;
    const team2Members = (match.team2 as Record<string, unknown>)?.memberNames as string[] | undefined;
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
    while (p1SetWins < matchSetsToWin && p2SetWins < matchSetsToWin) {
      let sc1 = 0, sc2 = 0;
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

      // 결정세트: 양측 세트 승수가 matchSetsToWin-1로 동점일 때만
      const isDecidingSet = !isTeamMatch && p1SetWins === matchSetsToWin - 1 && p2SetWins === matchSetsToWin - 1;
      const doSideChange = isTeamMatch || isDecidingSet;

      while (true) {
        // 세트 종료 조건: winScore 이상 + 2점 차이
        if ((sc1 >= matchWinScore || sc2 >= matchWinScore) && Math.abs(sc1 - sc2) >= 2) break;
        t += 10000 + Math.floor(Math.random() * 20000);

        // 사이드 체인지: 팀전=매 세트 16점, 개인전=결정세트만 6점 (득점 후 체크)
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
              p1MemberIdx = (p1MemberIdx + 1) % team1Members.length;
            } else if (servingTeam === "player2" && team2Members && team2Members.length > 0) {
              p2MemberIdx = (p2MemberIdx + 1) % team2Members.length;
            }
            history.push({ time: fmt(t), set: si + 1, scoringPlayer: "", actionPlayer: servingTeamName, actionType: "substitution", actionLabel: `${servingTeamName} 선수 교체`, points: 0, server: "", serveNumber: 0, scoreBefore: { player1: sc1, player2: sc2 }, scoreAfter: { player1: sc1, player2: sc2 }, serverSide: currentServer });
          }

          // 서버 교대
          currentServer = currentServer === "player1" ? "player2" : "player1";
        }
        if (history.length > 120) break;
      }

      // 세트 종료 → 결과 저장
      const setWinnerId = sc1 > sc2 ? p1Id3 : p2Id3;
      sets.push({ player1Score: sc1, player2Score: sc2, winnerId: setWinnerId });
      if (sc1 > sc2) p1SetWins++; else p2SetWins++;
      si++;
    }

    // 승자 결정
    const finalWinnerId = p1SetWins > p2SetWins ? p1Id3 : p2Id3;
    const winnerName = p1SetWins > p2SetWins
      ? (match.player1Name || match.team1Name || "P1") as string
      : (match.player2Name || match.team2Name || "P2") as string;
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
    const advanceBulk: Record<string, unknown> = {};
    let advanceCount = 0;
    const allM = refreshSnap.val() as Record<string, Record<string, unknown>>;

    for (const [nextId, nextMatch] of Object.entries(allM)) {
      if (nextMatch.status !== "pending") continue;
      const src1 = nextMatch.sourceMatch1 as string | undefined;
      const src2 = nextMatch.sourceMatch2 as string | undefined;
      if (!src1 && !src2) continue;

      const isLoser = nextMatch.sourceType === "loser";
      let changed = false;

      if (src1 && allM[src1]?.status === "completed" && (!nextMatch.player1Id || nextMatch.player1Id === "")) {
        const srcM = allM[src1];
        const wId = srcM.winnerId as string;
        const wName = (wId === (srcM.player1Id || srcM.team1Id) ? (srcM.player1Name || srcM.team1Name) : (srcM.player2Name || srcM.team2Name)) as string;
        const lId = (wId === (srcM.player1Id || srcM.team1Id) ? (srcM.player2Id || srcM.team2Id) : (srcM.player1Id || srcM.team1Id)) as string;
        const lName = (wId === (srcM.player1Id || srcM.team1Id) ? (srcM.player2Name || srcM.team2Name) : (srcM.player1Name || srcM.team1Name)) as string;
        const useId = isLoser ? lId : wId;
        const useName = isLoser ? lName : wName;
        advanceBulk[`matches/${tid}/${nextId}/player1Id`] = useId;
        advanceBulk[`matches/${tid}/${nextId}/player1Name`] = useName;
        advanceBulk[`matches/${tid}/${nextId}/team1Id`] = useId;
        advanceBulk[`matches/${tid}/${nextId}/team1Name`] = useName;
        changed = true;
      }
      if (src2 && allM[src2]?.status === "completed" && (!nextMatch.player2Id || nextMatch.player2Id === "")) {
        const srcM = allM[src2];
        const wId = srcM.winnerId as string;
        const wName = (wId === (srcM.player1Id || srcM.team1Id) ? (srcM.player1Name || srcM.team1Name) : (srcM.player2Name || srcM.team2Name)) as string;
        const lId = (wId === (srcM.player1Id || srcM.team1Id) ? (srcM.player2Id || srcM.team2Id) : (srcM.player1Id || srcM.team1Id)) as string;
        const lName = (wId === (srcM.player1Id || srcM.team1Id) ? (srcM.player2Name || srcM.team2Name) : (srcM.player1Name || srcM.team1Name)) as string;
        const useId = isLoser ? lId : wId;
        const useName = isLoser ? lName : wName;
        advanceBulk[`matches/${tid}/${nextId}/player2Id`] = useId;
        advanceBulk[`matches/${tid}/${nextId}/player2Name`] = useName;
        advanceBulk[`matches/${tid}/${nextId}/team2Id`] = useId;
        advanceBulk[`matches/${tid}/${nextId}/team2Name`] = useName;
        changed = true;
      }
      if (changed) advanceCount++;
    }

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
    const skipAutoGen = (input.skipAutoGenerate as boolean) || false;
    const tourFormat = tourData.format as string || "";
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
            const sid = m.stageId as string | undefined;
            return sid && sid.includes("finals");
          });
          if (!finalsExist) {
            // 대회 설정에서 파라미터 추출
            const simFc = tourData.finalsConfig as Record<string, unknown> | undefined;
            const genResult = await executeTool("generate_finals", {
              tournamentId: tid,
              advancePerGroup: (simFc?.advancePerGroup as number) || 2,
              wildcardCount: (simFc?.wildcardCount as number) || 0,
              includeThirdPlace: true,
              includeFifthToEighth: true,
              includeClassification: true,
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
