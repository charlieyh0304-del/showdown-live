import * as admin from "firebase-admin";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";

const db = admin.database();

// ===== Tool Definitions for Claude =====

export const TOOL_DEFINITIONS: Tool[] = [
  // --- Read ---
  {
    name: "list_tournaments",
    description: "대회 목록 조회. Returns array of tournaments with id, name, date, status, type.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_tournament",
    description: "특정 대회 상세 정보 조회.",
    input_schema: {
      type: "object" as const,
      properties: { tournamentId: { type: "string", description: "대회 ID" } },
      required: ["tournamentId"],
    },
  },
  {
    name: "list_players",
    description: "선수 목록 조회. tournamentId가 있으면 해당 대회 선수, 없으면 전역 선수.",
    input_schema: {
      type: "object" as const,
      properties: { tournamentId: { type: "string", description: "대회 ID (선택)" } },
      required: [],
    },
  },
  {
    name: "list_matches",
    description: "경기 목록 조회. status로 필터 가능 (pending, in_progress, completed).",
    input_schema: {
      type: "object" as const,
      properties: {
        tournamentId: { type: "string" },
        status: { type: "string", description: "pending | in_progress | completed (선택)" },
      },
      required: ["tournamentId"],
    },
  },
  {
    name: "list_courts",
    description: "경기장(코트) 목록 조회.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "list_referees",
    description: "심판 목록 조회.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_schedule",
    description: "스케줄 조회.",
    input_schema: {
      type: "object" as const,
      properties: { tournamentId: { type: "string" } },
      required: ["tournamentId"],
    },
  },

  // --- Write: Tournament ---
  {
    name: "create_tournament",
    description: "새 대회 생성. 반환: 생성된 대회 ID.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "대회 이름" },
        date: { type: "string", description: "YYYY-MM-DD" },
        endDate: { type: "string", description: "YYYY-MM-DD (선택)" },
        type: { type: "string", enum: ["individual", "team", "randomTeamLeague"], description: "대회 유형" },
        formatType: { type: "string", enum: ["round_robin", "single_elimination", "group_knockout", "manual"], description: "대진 방식" },
        winScore: { type: "number", description: "승리 점수 (기본 11)" },
        setsToWin: { type: "number", description: "승리 세트 수 (기본 3)" },
      },
      required: ["name", "date", "type"],
    },
  },
  {
    name: "update_tournament",
    description: "대회 정보 수정. 변경할 필드만 전달.",
    input_schema: {
      type: "object" as const,
      properties: {
        tournamentId: { type: "string" },
        name: { type: "string" },
        date: { type: "string" },
        status: { type: "string", enum: ["draft", "registration", "in_progress", "paused", "completed"] },
      },
      required: ["tournamentId"],
    },
  },

  // --- Write: Players ---
  {
    name: "add_players_bulk",
    description: "여러 선수를 한 번에 추가. tournamentId가 있으면 대회 선수로, 없으면 전역 선수로 추가.",
    input_schema: {
      type: "object" as const,
      properties: {
        players: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              club: { type: "string" },
              class: { type: "string", enum: ["", "B1", "B2", "B3"] },
              gender: { type: "string", enum: ["male", "female", ""] },
            },
            required: ["name"],
          },
        },
        tournamentId: { type: "string", description: "대회 ID (선택, 없으면 전역)" },
      },
      required: ["players"],
    },
  },
  {
    name: "delete_player",
    description: "선수 삭제.",
    input_schema: {
      type: "object" as const,
      properties: {
        playerId: { type: "string" },
        tournamentId: { type: "string", description: "대회 ID (선택, 없으면 전역)" },
      },
      required: ["playerId"],
    },
  },

  // --- Write: Matches ---
  {
    name: "add_match",
    description: "경기 1개 추가.",
    input_schema: {
      type: "object" as const,
      properties: {
        tournamentId: { type: "string" },
        player1Id: { type: "string" },
        player2Id: { type: "string" },
        player1Name: { type: "string" },
        player2Name: { type: "string" },
        round: { type: "number" },
        groupId: { type: "string" },
      },
      required: ["tournamentId", "player1Id", "player2Id", "player1Name", "player2Name"],
    },
  },
  {
    name: "update_match",
    description: "경기 정보 수정 (선수 변경, 코트/시간 배정, 상태 변경 등).",
    input_schema: {
      type: "object" as const,
      properties: {
        tournamentId: { type: "string" },
        matchId: { type: "string" },
        player1Id: { type: "string" },
        player2Id: { type: "string" },
        player1Name: { type: "string" },
        player2Name: { type: "string" },
        courtId: { type: "string" },
        courtName: { type: "string" },
        scheduledTime: { type: "string", description: "HH:MM" },
        scheduledDate: { type: "string", description: "YYYY-MM-DD" },
        status: { type: "string", enum: ["pending", "in_progress", "completed"] },
        refereeId: { type: "string" },
        refereeName: { type: "string" },
        winnerId: { type: "string", description: "부전승 처리 시 승자 ID" },
      },
      required: ["tournamentId", "matchId"],
    },
  },
  {
    name: "delete_match",
    description: "경기 삭제.",
    input_schema: {
      type: "object" as const,
      properties: {
        tournamentId: { type: "string" },
        matchId: { type: "string" },
      },
      required: ["tournamentId", "matchId"],
    },
  },
  {
    name: "generate_round_robin",
    description: "라운드로빈 대진 자동 생성. 지정된 선수들 간 모든 조합의 경기를 생성.",
    input_schema: {
      type: "object" as const,
      properties: {
        tournamentId: { type: "string" },
        playerIds: { type: "array", items: { type: "string" }, description: "선수 ID 배열 (비어있으면 대회 전체 선수)" },
        groupId: { type: "string", description: "조 ID (선택)" },
      },
      required: ["tournamentId"],
    },
  },

  // --- Write: Schedule ---
  {
    name: "generate_schedule",
    description: "고급 스케줄 자동 생성. 선수 휴식 시간, 연속 경기 방지, 점심시간 제외, 마감/다음날 시작 등 복잡한 조건 지원.",
    input_schema: {
      type: "object" as const,
      properties: {
        tournamentId: { type: "string" },
        startTime: { type: "string", description: "HH:MM (기본 09:00)" },
        endTime: { type: "string", description: "HH:MM (기본 19:00)" },
        intervalMinutes: { type: "number", description: "경기 간격 분 (기본 30)" },
        playerRestMinutes: { type: "number", description: "선수당 최소 휴식 시간 분 (기본 60, 연속 경기 방지)" },
        scheduleDate: { type: "string", description: "YYYY-MM-DD 시작 날짜" },
        nextDayStartTime: { type: "string", description: "다음날 시작 시간 HH:MM (기본 09:00)" },
        breakStart: { type: "string", description: "휴식 시작 HH:MM (예: 12:00 점심)" },
        breakEnd: { type: "string", description: "휴식 종료 HH:MM (예: 13:00)" },
        stageFilter: { type: "string", description: "stageId 필터 (예선/본선 구분, 선택)" },
        onlyUnassigned: { type: "boolean", description: "미배정 경기만 (기본 false)" },
      },
      required: ["tournamentId"],
    },
  },
  {
    name: "shift_schedule",
    description: "스케줄 일괄 시간 이동. 모든 경기 또는 특정 경기의 시간을 분 단위로 앞/뒤로 조정.",
    input_schema: {
      type: "object" as const,
      properties: {
        tournamentId: { type: "string" },
        shiftMinutes: { type: "number", description: "이동할 분 (양수=뒤로, 음수=앞으로)" },
        matchIds: { type: "array", items: { type: "string" }, description: "특정 경기만 (비어있으면 전체)" },
        courtId: { type: "string", description: "특정 코트만 (선택)" },
      },
      required: ["tournamentId", "shiftMinutes"],
    },
  },
  {
    name: "move_matches_to_court",
    description: "특정 코트의 경기를 다른 코트로 이동.",
    input_schema: {
      type: "object" as const,
      properties: {
        tournamentId: { type: "string" },
        fromCourtId: { type: "string" },
        toCourtId: { type: "string" },
        toCourtName: { type: "string" },
      },
      required: ["tournamentId", "fromCourtId", "toCourtId", "toCourtName"],
    },
  },

  // --- Write: Courts & Referees ---
  {
    name: "add_court",
    description: "코트(경기장) 추가.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string" },
        location: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "add_referee",
    description: "심판 추가.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string" },
        role: { type: "string", enum: ["main", "assistant"], description: "main(주심) or assistant(부심)" },
      },
      required: ["name"],
    },
  },
];

// ===== Tool Executor =====

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  try {
    switch (name) {
      // --- Read ---
      case "list_tournaments": {
        const snap = await db.ref("tournaments").once("value");
        if (!snap.exists()) return JSON.stringify([]);
        const list = Object.entries(snap.val()).map(([id, v]) => {
          const t = v as Record<string, unknown>;
          return { id, name: t.name, date: t.date, status: t.status, type: t.type, formatType: t.formatType };
        });
        return JSON.stringify(list);
      }

      case "get_tournament": {
        const snap = await db.ref(`tournaments/${input.tournamentId}`).once("value");
        if (!snap.exists()) return JSON.stringify({ error: "대회를 찾을 수 없습니다." });
        return JSON.stringify({ id: input.tournamentId, ...snap.val() });
      }

      case "list_players": {
        const path = input.tournamentId ? `tournamentPlayers/${input.tournamentId}` : "players";
        const snap = await db.ref(path).once("value");
        if (!snap.exists()) return JSON.stringify([]);
        const list = Object.entries(snap.val()).map(([id, v]) => ({ id, ...(v as object) }));
        return JSON.stringify(list.slice(0, 100)); // limit
      }

      case "list_matches": {
        const snap = await db.ref(`matches/${input.tournamentId}`).once("value");
        if (!snap.exists()) return JSON.stringify([]);
        let list = Object.entries(snap.val()).map(([id, v]) => ({ id, ...(v as object) }));
        if (input.status) list = list.filter((m: Record<string, unknown>) => m.status === input.status);
        return JSON.stringify(list.slice(0, 100));
      }

      case "list_courts": {
        const snap = await db.ref("courts").once("value");
        if (!snap.exists()) return JSON.stringify([]);
        return JSON.stringify(Object.entries(snap.val()).map(([id, v]) => ({ id, ...(v as object) })));
      }

      case "list_referees": {
        const snap = await db.ref("referees").once("value");
        if (!snap.exists()) return JSON.stringify([]);
        return JSON.stringify(Object.entries(snap.val()).map(([id, v]) => ({ id, ...(v as object) })));
      }

      case "get_schedule": {
        const snap = await db.ref(`schedule/${input.tournamentId}`).once("value");
        if (!snap.exists()) return JSON.stringify([]);
        return JSON.stringify(Object.entries(snap.val()).map(([id, v]) => ({ id, ...(v as object) })));
      }

      // --- Write: Tournament ---
      case "create_tournament": {
        const now = Date.now();
        const newRef = db.ref("tournaments").push();
        const data = {
          name: input.name || "새 대회",
          date: input.date || new Date().toISOString().split("T")[0],
          ...(input.endDate ? { endDate: input.endDate } : {}),
          type: input.type || "individual",
          format: "full_league",
          formatType: input.formatType || "round_robin",
          status: "draft",
          gameConfig: {
            winScore: input.winScore || 11,
            setsToWin: input.setsToWin || 3,
          },
          createdAt: now,
          updatedAt: now,
        };
        await newRef.set(data);
        return JSON.stringify({ success: true, tournamentId: newRef.key, message: `대회 "${data.name}" 생성 완료` });
      }

      case "update_tournament": {
        const { tournamentId, ...fields } = input;
        const updates: Record<string, unknown> = { ...fields, updatedAt: Date.now() };
        delete updates.tournamentId;
        await db.ref(`tournaments/${tournamentId}`).update(updates);
        return JSON.stringify({ success: true, message: "대회 정보 수정 완료" });
      }

      // --- Write: Players ---
      case "add_players_bulk": {
        const players = input.players as Array<{ name: string; club?: string; class?: string; gender?: string }>;
        const path = input.tournamentId ? `tournamentPlayers/${input.tournamentId}` : "players";
        const now = Date.now();
        const ids: string[] = [];
        for (const p of players) {
          const newRef = db.ref(path).push();
          await newRef.set({ name: p.name, club: p.club || "", class: p.class || "", gender: p.gender || "", createdAt: now });
          ids.push(newRef.key!);
        }
        return JSON.stringify({ success: true, count: players.length, ids, message: `${players.length}명 추가 완료` });
      }

      case "delete_player": {
        const path = input.tournamentId ? `tournamentPlayers/${input.tournamentId}/${input.playerId}` : `players/${input.playerId}`;
        await db.ref(path).remove();
        return JSON.stringify({ success: true, message: "선수 삭제 완료" });
      }

      // --- Write: Matches ---
      case "add_match": {
        const now = Date.now();
        const newRef = db.ref(`matches/${input.tournamentId}`).push();
        await newRef.set({
          tournamentId: input.tournamentId,
          type: "individual",
          status: "pending",
          round: input.round || 1,
          player1Id: input.player1Id,
          player2Id: input.player2Id,
          player1Name: input.player1Name,
          player2Name: input.player2Name,
          sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
          currentSet: 0,
          player1Timeouts: 0,
          player2Timeouts: 0,
          winnerId: null,
          createdAt: now,
          ...(input.groupId ? { groupId: input.groupId } : {}),
        });
        return JSON.stringify({ success: true, matchId: newRef.key, message: `${input.player1Name} vs ${input.player2Name} 경기 추가` });
      }

      case "update_match": {
        const { tournamentId, matchId, ...fields } = input;
        const updates: Record<string, unknown> = { ...fields, updatedAt: Date.now() };
        delete updates.tournamentId;
        delete updates.matchId;
        await db.ref(`matches/${tournamentId}/${matchId}`).update(updates);
        return JSON.stringify({ success: true, message: "경기 수정 완료" });
      }

      case "delete_match": {
        await db.ref(`matches/${input.tournamentId}/${input.matchId}`).remove();
        return JSON.stringify({ success: true, message: "경기 삭제 완료" });
      }

      case "generate_round_robin": {
        const tid = input.tournamentId as string;
        let playerIds = input.playerIds as string[] | undefined;

        if (!playerIds || playerIds.length === 0) {
          const snap = await db.ref(`tournamentPlayers/${tid}`).once("value");
          if (!snap.exists()) return JSON.stringify({ error: "선수가 없습니다." });
          playerIds = Object.keys(snap.val());
        }

        // Get player names
        const playerSnap = await db.ref(`tournamentPlayers/${tid}`).once("value");
        const playerData = playerSnap.exists() ? playerSnap.val() : {};
        const nameMap = new Map<string, string>();
        for (const [id, v] of Object.entries(playerData)) {
          nameMap.set(id, (v as { name: string }).name);
        }

        const now = Date.now();
        const matches: Record<string, unknown>[] = [];
        for (let i = 0; i < playerIds.length; i++) {
          for (let j = i + 1; j < playerIds.length; j++) {
            matches.push({
              tournamentId: tid,
              type: "individual",
              status: "pending",
              round: matches.length + 1,
              player1Id: playerIds[i],
              player2Id: playerIds[j],
              player1Name: nameMap.get(playerIds[i]) || playerIds[i],
              player2Name: nameMap.get(playerIds[j]) || playerIds[j],
              sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
              currentSet: 0,
              player1Timeouts: 0,
              player2Timeouts: 0,
              winnerId: null,
              createdAt: now + matches.length,
              ...(input.groupId ? { groupId: input.groupId } : {}),
            });
          }
        }

        const matchesRef = db.ref(`matches/${tid}`);
        for (const m of matches) {
          await matchesRef.push().set(m);
        }

        return JSON.stringify({ success: true, count: matches.length, message: `${matches.length}경기 라운드로빈 생성 완료` });
      }

      // --- Write: Schedule (고급) ---
      case "generate_schedule": {
        const tid = input.tournamentId as string;
        const startTime = (input.startTime as string) || "09:00";
        const endTime = (input.endTime as string) || "19:00";
        const interval = (input.intervalMinutes as number) || 30;
        const playerRest = (input.playerRestMinutes as number) || 60;
        const scheduleDate = (input.scheduleDate as string) || new Date().toISOString().split("T")[0];
        const nextDayStart = (input.nextDayStartTime as string) || startTime;
        const breakStartStr = input.breakStart as string | undefined;
        const breakEndStr = input.breakEnd as string | undefined;
        const stageFilter = input.stageFilter as string | undefined;
        const onlyUnassigned = (input.onlyUnassigned as boolean) || false;

        const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
        const fmtMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

        const dayStart = toMin(startTime);
        const dayEnd = toMin(endTime);
        const nextDayStartMin = toMin(nextDayStart);
        const breakStart = breakStartStr ? toMin(breakStartStr) : -1;
        const breakEnd = breakEndStr ? toMin(breakEndStr) : -1;

        const matchesSnap = await db.ref(`matches/${tid}`).once("value");
        if (!matchesSnap.exists()) return JSON.stringify({ error: "경기가 없습니다." });
        const courtsSnap = await db.ref("courts").once("value");
        if (!courtsSnap.exists()) return JSON.stringify({ error: "코트가 없습니다." });

        type MatchEntry = Record<string, unknown> & { id: string };
        let matchList: MatchEntry[] = Object.entries(matchesSnap.val())
          .map(([id, v]) => ({ id, ...(v as Record<string, unknown>) }));

        // 필터: 미배정만 or pending만
        if (onlyUnassigned) {
          matchList = matchList.filter((m) =>
            (m.status === "pending" || m.status === "in_progress") && !m.scheduledDate);
        } else {
          matchList = matchList.filter((m) => m.status === "pending" || m.status === "in_progress");
        }

        // 스테이지 필터
        if (stageFilter) {
          matchList = matchList.filter((m) => m.stageId === stageFilter);
        }

        if (matchList.length === 0) return JSON.stringify({ error: "배정할 경기가 없습니다." });

        const courtList = Object.entries(courtsSnap.val()).map(([id, v]) => ({ id, ...(v as { name: string }) }));

        // 코트별 다음 가용 시간
        const courtSlots = courtList.map((c) => ({ courtId: c.id, courtName: c.name, date: scheduleDate, time: dayStart }));

        // 선수별 마지막 종료 시간 (연속 경기 방지)
        const playerLastEnd = new Map<string, { date: string; time: number }>();

        // 경기에서 선수 ID 추출
        const getPlayerIds = (m: Record<string, unknown>): string[] => {
          const ids: string[] = [];
          if (m.player1Id) ids.push(m.player1Id as string);
          if (m.player2Id) ids.push(m.player2Id as string);
          if (m.team1Id) ids.push(m.team1Id as string);
          if (m.team2Id) ids.push(m.team2Id as string);
          return ids;
        };

        // 시간이 휴식 시간에 걸리면 휴식 끝으로 밀기
        const skipBreak = (time: number): number => {
          if (breakStart >= 0 && breakEnd >= 0 && time >= breakStart && time < breakEnd) {
            return breakEnd;
          }
          return time;
        };

        const slots: Record<string, unknown>[] = [];
        let skippedCount = 0;

        for (const match of matchList) {
          const playerIds = getPlayerIds(match);
          let bestCourtIdx = -1;
          let bestDate = scheduleDate;
          let bestTime = Infinity;

          // 각 코트에서 가장 빠른 가용 시간 찾기
          for (let ci = 0; ci < courtSlots.length; ci++) {
            const court = courtSlots[ci];
            let candidateDate = court.date;
            let candidateTime = skipBreak(court.time);

            // 선수 휴식 시간 확인
            for (const pid of playerIds) {
              const last = playerLastEnd.get(pid);
              if (last) {
                if (last.date === candidateDate && last.time > candidateTime) {
                  candidateTime = skipBreak(last.time);
                } else if (last.date > candidateDate) {
                  candidateDate = last.date;
                  candidateTime = skipBreak(Math.max(nextDayStartMin, last.time));
                }
              }
            }

            // 휴식 시간 재확인
            candidateTime = skipBreak(candidateTime);

            // 마감 초과 시 다음날로
            if (candidateTime >= dayEnd) {
              candidateDate = addDays(candidateDate, 1);
              candidateTime = nextDayStartMin;
              candidateTime = skipBreak(candidateTime);
            }

            const candidateTotal = new Date(candidateDate).getTime() + candidateTime;
            const bestTotal = new Date(bestDate).getTime() + bestTime;
            if (bestCourtIdx === -1 || candidateTotal < bestTotal) {
              bestCourtIdx = ci;
              bestDate = candidateDate;
              bestTime = candidateTime;
            }
          }

          if (bestCourtIdx === -1) { skippedCount++; continue; }

          // 마감 재확인
          if (bestTime >= dayEnd) {
            bestDate = addDays(bestDate, 1);
            bestTime = skipBreak(nextDayStartMin);
          }

          const court = courtSlots[bestCourtIdx];
          const timeStr = fmtMin(bestTime);
          const label = `${match.player1Name || match.team1Name || ""} vs ${match.player2Name || match.team2Name || ""}`;

          slots.push({
            matchId: match.id,
            courtId: court.courtId,
            courtName: court.courtName,
            scheduledTime: timeStr,
            scheduledDate: bestDate,
            label,
            status: match.status || "pending",
          });

          // Firebase 경기 업데이트
          await db.ref(`matches/${tid}/${match.id}`).update({
            scheduledTime: timeStr,
            scheduledDate: bestDate,
            courtId: court.courtId,
            courtName: court.courtName,
          });

          // 코트 다음 가용 시간 업데이트
          const courtEndTime = bestTime + interval;
          if (courtEndTime >= dayEnd) {
            court.date = addDays(bestDate, 1);
            court.time = nextDayStartMin;
          } else {
            court.date = bestDate;
            court.time = courtEndTime;
          }

          // 선수 마지막 종료 시간 업데이트 (playerRest 적용)
          const playerEndTime = bestTime + playerRest;
          const playerEnd = playerEndTime >= dayEnd
            ? { date: addDays(bestDate, 1), time: nextDayStartMin }
            : { date: bestDate, time: playerEndTime };
          for (const pid of playerIds) {
            playerLastEnd.set(pid, playerEnd);
          }
        }

        // 스케줄 저장
        if (onlyUnassigned) {
          // 기존 유지 + 새 슬롯 추가
          const existingSnap = await db.ref(`schedule/${tid}`).once("value");
          const existingSlots: Record<string, unknown>[] = [];
          if (existingSnap.exists()) {
            existingSnap.forEach((child) => {
              existingSlots.push(child.val());
            });
          }
          await db.ref(`schedule/${tid}`).remove();
          for (const slot of [...existingSlots, ...slots]) {
            await db.ref(`schedule/${tid}`).push().set(slot);
          }
        } else {
          await db.ref(`schedule/${tid}`).remove();
          for (const slot of slots) {
            await db.ref(`schedule/${tid}`).push().set(slot);
          }
        }

        // 결과 요약
        const dates = [...new Set(slots.map((s) => s.scheduledDate as string))].sort();
        const summary = dates.map((d) => {
          const daySlots = slots.filter((s) => s.scheduledDate === d);
          const times = daySlots.map((s) => s.scheduledTime as string).sort();
          return `${d}: ${daySlots.length}경기 (${times[0]}~${times[times.length - 1]})`;
        }).join(", ");

        return JSON.stringify({
          success: true,
          count: slots.length,
          skipped: skippedCount,
          dates: dates.length,
          summary,
          settings: { interval, playerRest, breakTime: breakStartStr ? `${breakStartStr}-${breakEndStr}` : "없음", endTime },
          message: `${slots.length}경기 스케줄 생성 완료 (${dates.length}일, 선수 휴식 ${playerRest}분, 경기 간격 ${interval}분${breakStartStr ? `, 점심 ${breakStartStr}-${breakEndStr}` : ""})`,
        });
      }

      case "shift_schedule": {
        const tid = input.tournamentId as string;
        const shift = input.shiftMinutes as number;
        const matchIds = input.matchIds as string[] | undefined;
        const courtId = input.courtId as string | undefined;

        const matchesSnap = await db.ref(`matches/${tid}`).once("value");
        if (!matchesSnap.exists()) return JSON.stringify({ error: "경기가 없습니다." });

        let count = 0;
        const allMatches = matchesSnap.val() as Record<string, Record<string, unknown>>;
        for (const [mid, match] of Object.entries(allMatches)) {
          if (!match.scheduledTime) continue;
          if (matchIds && matchIds.length > 0 && !matchIds.includes(mid)) continue;
          if (courtId && match.courtId !== courtId) continue;

          const [h, m] = (match.scheduledTime as string).split(":").map(Number);
          const newMin = h * 60 + m + shift;
          const newTime = `${String(Math.floor(newMin / 60)).padStart(2, "0")}:${String(newMin % 60).padStart(2, "0")}`;
          await db.ref(`matches/${tid}/${mid}`).update({ scheduledTime: newTime });
          count++;
        }

        // Update schedule too
        const schedSnap = await db.ref(`schedule/${tid}`).once("value");
        if (schedSnap.exists()) {
          for (const [sid, slot] of Object.entries(schedSnap.val() as Record<string, Record<string, unknown>>)) {
            if (!slot.scheduledTime) continue;
            const matchId = slot.matchId as string;
            if (matchIds && matchIds.length > 0 && !matchIds.includes(matchId)) continue;
            if (courtId && slot.courtId !== courtId) continue;

            const [h, m] = (slot.scheduledTime as string).split(":").map(Number);
            const newMin = h * 60 + m + shift;
            const newTime = `${String(Math.floor(newMin / 60)).padStart(2, "0")}:${String(newMin % 60).padStart(2, "0")}`;
            await db.ref(`schedule/${tid}/${sid}`).update({ scheduledTime: newTime });
          }
        }

        return JSON.stringify({ success: true, count, message: `${count}경기 ${shift > 0 ? `${shift}분 뒤로` : `${-shift}분 앞으로`} 이동` });
      }

      case "move_matches_to_court": {
        const tid = input.tournamentId as string;
        const fromCourtId = input.fromCourtId as string;
        const toCourtId = input.toCourtId as string;
        const toCourtName = input.toCourtName as string;

        const matchesSnap = await db.ref(`matches/${tid}`).once("value");
        if (!matchesSnap.exists()) return JSON.stringify({ error: "경기가 없습니다." });

        let count = 0;
        for (const [mid, match] of Object.entries(matchesSnap.val() as Record<string, Record<string, unknown>>)) {
          if (match.courtId === fromCourtId) {
            await db.ref(`matches/${tid}/${mid}`).update({ courtId: toCourtId, courtName: toCourtName });
            count++;
          }
        }

        return JSON.stringify({ success: true, count, message: `${count}경기 코트 이동 완료` });
      }

      // --- Write: Courts & Referees ---
      case "add_court": {
        const newRef = db.ref("courts").push();
        await newRef.set({ name: input.name, location: input.location || "", assignedReferees: [], createdAt: Date.now() });
        return JSON.stringify({ success: true, courtId: newRef.key, message: `코트 "${input.name}" 추가 완료` });
      }

      case "add_referee": {
        const newRef = db.ref("referees").push();
        await newRef.set({ name: input.name, role: input.role || "main", createdAt: Date.now() });
        return JSON.stringify({ success: true, refereeId: newRef.key, message: `심판 "${input.name}" 추가 완료` });
      }

      default:
        return JSON.stringify({ error: `알 수 없는 도구: ${name}` });
    }
  } catch (err: unknown) {
    const e = err as { message?: string };
    return JSON.stringify({ error: e.message || "도구 실행 실패" });
  }
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}
