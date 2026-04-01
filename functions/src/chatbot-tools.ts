import * as admin from "firebase-admin";
import * as crypto from "crypto";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";

const db = admin.database();

// PIN 해시 (SHA-256, 클라이언트 호환)
async function hashPinSHA256(pin: string): Promise<string> {
  return crypto.createHash("sha256").update(pin).digest("hex");
}

// PIN 해시 (PBKDF2, 클라이언트 호환)
async function hashPinPBKDF2(pin: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(pin, salt, 100000, 32, "sha256", (err, key) => {
      if (err) reject(err);
      else resolve(`${salt}:${key.toString("hex")}`);
    });
  });
}

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
    name: "setup_full_tournament",
    description: "복잡한 대회를 한 번에 생성: 대회 생성 + 선수 등록 + 스테이지(예선/본선) 설정 + 조 편성(시드 포함) + 예선 라운드로빈 경기 생성 + 순위결정전 설정. 조별리그+토너먼트 같은 복합 구조를 처리합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "대회 이름" },
        date: { type: "string", description: "시작일 YYYY-MM-DD" },
        endDate: { type: "string", description: "종료일 YYYY-MM-DD (선택)" },
        type: { type: "string", enum: ["individual", "team"], description: "개인전/팀전" },
        players: { type: "array", items: { type: "object", properties: { name: { type: "string" }, club: { type: "string" }, class: { type: "string" }, gender: { type: "string" } }, required: ["name"] }, description: "선수 목록" },
        groupCount: { type: "number", description: "조 수 (예: 8)" },
        advancePerGroup: { type: "number", description: "조당 본선 진출자 수 (예: 2)" },
        seeds: { type: "array", items: { type: "string" }, description: "탑시드 선수 이름 목록 (각 조에 1명씩 배치)" },
        qualifyingWinScore: { type: "number", description: "예선 승리 점수 (기본 11)" },
        qualifyingSetsToWin: { type: "number", description: "예선 승리 세트 수 (3세트=2, 5세트=3, 기본 2)" },
        finalsFormat: { type: "string", enum: ["single_elimination", "double_elimination"], description: "본선 방식 (기본 single_elimination)" },
        thirdPlace: { type: "boolean", description: "3/4위 결정전 (기본 true)" },
        fifthToEighth: { type: "boolean", description: "5~8위 결정전 (기본 false)" },
        classificationGroups: { type: "boolean", description: "하위 순위 그룹 결정전 (기본 false)" },
      },
      required: ["name", "date", "type", "players", "groupCount"],
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

  {
    name: "delete_tournament",
    description: "대회 삭제 (관련 경기, 선수, 스케줄, 팀 데이터 모두 삭제). 관리자 PIN이 필요합니다. 반드시 사용자에게 PIN을 물어본 후 호출하세요.",
    input_schema: {
      type: "object" as const,
      properties: {
        tournamentId: { type: "string", description: "삭제할 대회 ID" },
        adminPin: { type: "string", description: "관리자 PIN (보안 확인용)" },
      },
      required: ["tournamentId", "adminPin"],
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
    name: "simulate_matches",
    description: "경기 시뮬레이션: pending 상태인 경기들을 랜덤 점수로 완료 처리. setsToWin 미지정 시 대회 설정값 자동 사용. 3세트=setsToWin:2, 5세트=setsToWin:3.",
    input_schema: {
      type: "object" as const,
      properties: {
        tournamentId: { type: "string" },
        stageId: { type: "string", description: "특정 스테이지만 (선택)" },
        groupId: { type: "string", description: "특정 조만 (선택)" },
        winScore: { type: "number", description: "세트당 승리 점수 (미지정 시 대회 설정 사용)" },
        setsToWin: { type: "number", description: "승리 세트 수: 3세트=2, 5세트=3 (미지정 시 대회 설정 사용)" },
      },
      required: ["tournamentId"],
    },
  },
  {
    name: "generate_finals",
    description: "예선 결과를 기반으로 본선 토너먼트 대진을 자동 생성. 각 조 상위 N명을 추출하여 16강/8강/4강/결승 + 순위결정전(3-4위, 5-8위) 경기를 생성.",
    input_schema: {
      type: "object" as const,
      properties: {
        tournamentId: { type: "string" },
        advancePerGroup: { type: "number", description: "조당 진출자 수 (기본: 대회 설정값)" },
        includeThirdPlace: { type: "boolean", description: "3/4위 결정전 (기본 true)" },
        includeFifthToEighth: { type: "boolean", description: "5-8위 결정전 (기본 false)" },
        includeClassification: { type: "boolean", description: "하위 순위 결정전 (기본 false)" },
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

      case "setup_full_tournament": {
        const now = Date.now();
        const players = input.players as Array<{ name: string; club?: string; class?: string; gender?: string }>;
        const groupCount = (input.groupCount as number) || 4;
        const advancePerGroup = (input.advancePerGroup as number) || 2;
        const seeds = (input.seeds as string[]) || [];
        const qualWinScore = (input.qualifyingWinScore as number) || 11;
        const qualSetsToWin = (input.qualifyingSetsToWin as number) || 2;
        const finalsFormat = (input.finalsFormat as string) || "single_elimination";
        const thirdPlace = input.thirdPlace !== false;
        const fifthToEighth = (input.fifthToEighth as boolean) || false;
        const classificationGroups = (input.classificationGroups as boolean) || false;
        const totalAdvance = groupCount * advancePerGroup;

        // 입력 검증
        if (!players || players.length < 2) return JSON.stringify({ error: "최소 2명의 선수가 필요합니다." });
        if (players.length > 10000) return JSON.stringify({ error: "최대 10,000명까지 지원합니다." });
        if (groupCount > players.length) return JSON.stringify({ error: `조 수(${groupCount})가 선수 수(${players.length})를 초과할 수 없습니다.` });

        // 중복 이름 검사
        const nameSet = new Set<string>();
        for (const p of players) {
          if (nameSet.has(p.name)) return JSON.stringify({ error: `중복 선수명: ${p.name}` });
          nameSet.add(p.name);
        }

        // 시드 검증
        const invalidSeeds = seeds.filter(s => !nameSet.has(s));
        if (invalidSeeds.length > 0) return JSON.stringify({ error: `시드 선수를 찾을 수 없습니다: ${invalidSeeds.join(", ")}` });

        // 날짜 검증
        const dateStr = (input.date as string) || new Date().toISOString().split("T")[0];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return JSON.stringify({ error: "날짜 형식: YYYY-MM-DD" });

        // 1. 대회 생성
        const tourRef = db.ref("tournaments").push();
        const tid = tourRef.key!;
        const qualStageId = `stage_qualifying_${tid}`;
        const finalsStageId = `stage_finals_${tid}`;

        const tournamentData = {
          name: input.name || "새 대회",
          date: input.date || new Date().toISOString().split("T")[0],
          ...(input.endDate ? { endDate: input.endDate } : {}),
          type: input.type || "individual",
          format: "group_league",
          formatType: "group_knockout",
          status: "draft",
          gameConfig: { winScore: qualWinScore, setsToWin: qualSetsToWin },
          qualifyingConfig: { format: "group_round_robin", groupCount },
          finalsConfig: {
            format: finalsFormat,
            advanceCount: totalAdvance,
            startingRound: totalAdvance,
            seedMethod: "ranking",
            advancePerGroup,
          },
          rankingMatchConfig: {
            enabled: thirdPlace || fifthToEighth || classificationGroups,
            thirdPlace,
            fifthToEighth,
            fifthToEighthFormat: "simple",
            classificationGroups,
            classificationGroupSize: 4,
          },
          stages: [
            { id: qualStageId, type: "qualifying", format: "group_round_robin", status: "pending", groupCount, groups: [] },
            { id: finalsStageId, type: "finals", format: finalsFormat, status: "pending", advanceCount: totalAdvance },
          ],
          createdAt: now,
          updatedAt: now,
        };
        await tourRef.set(tournamentData);

        // 2~4 전부 한 번의 multi-path update로 처리 (속도 극대화)
        const bulkUpdate: Record<string, unknown> = {};

        // 2. 선수 등록
        const playerMap = new Map<string, string>();
        for (const p of players) {
          const pKey = db.ref(`tournamentPlayers/${tid}`).push().key!;
          bulkUpdate[`tournamentPlayers/${tid}/${pKey}`] = { name: p.name, club: p.club || "", class: p.class || "", gender: p.gender || "", createdAt: now };
          playerMap.set(p.name, pKey);
        }
        const nameMap = new Map<string, string>();
        playerMap.forEach((id, name) => nameMap.set(id, name));

        // 3. 조 편성 (스네이크 드래프트 + 시드)
        const groups: Array<{ id: string; stageId: string; name: string; playerIds: string[]; teamIds: string[] }> = [];
        for (let i = 0; i < groupCount; i++) {
          groups.push({ id: `group_${String.fromCharCode(65 + i)}`, stageId: qualStageId, name: `${String.fromCharCode(65 + i)}조`, playerIds: [], teamIds: [] });
        }
        const seedSet = new Set<string>();
        for (let i = 0; i < Math.min(seeds.length, groupCount); i++) {
          const seedId = playerMap.get(seeds[i]);
          if (seedId) { groups[i].playerIds.push(seedId); seedSet.add(seedId); }
        }
        const remaining = players.map(p => playerMap.get(p.name)!).filter(id => id && !seedSet.has(id));
        for (let i = 0; i < remaining.length; i++) {
          const round = Math.floor(i / groupCount);
          const pos = i % groupCount;
          const groupIndex = round % 2 === 0 ? pos : groupCount - 1 - pos;
          groups[groupIndex].playerIds.push(remaining[i]);
        }

        // 스테이지 + 시드 (tournament 하위)
        bulkUpdate[`tournaments/${tid}/stages`] = [
          { ...tournamentData.stages[0], groups },
          tournamentData.stages[1],
        ];
        bulkUpdate[`tournaments/${tid}/seeds`] = seeds.map((name, i) => ({
          position: i + 1, playerId: playerMap.get(name) || "", name,
        }));

        // 4. 예선 라운드로빈 경기 생성
        let matchCount = 0;
        for (const group of groups) {
          const pids = group.playerIds;
          for (let i = 0; i < pids.length; i++) {
            for (let j = i + 1; j < pids.length; j++) {
              const mKey = db.ref(`matches/${tid}`).push().key!;
              bulkUpdate[`matches/${tid}/${mKey}`] = {
                tournamentId: tid, type: input.type || "individual", status: "pending",
                round: matchCount + 1, player1Id: pids[i], player2Id: pids[j],
                player1Name: nameMap.get(pids[i]) || pids[i], player2Name: nameMap.get(pids[j]) || pids[j],
                sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
                currentSet: 0, player1Timeouts: 0, player2Timeouts: 0, winnerId: null,
                createdAt: now + matchCount, groupId: group.id, stageId: qualStageId,
              };
              matchCount++;
            }
          }
        }

        // 한 번의 네트워크 요청으로 전부 쓰기
        await db.ref().update(bulkUpdate);

        const groupSummary = groups.map(g => `${g.name}: ${g.playerIds.map(id => nameMap.get(id) || id).join(", ")}`).join("\n");

        return JSON.stringify({
          success: true,
          tournamentId: tid,
          playerCount: players.length,
          groupCount,
          matchCount,
          advancePerGroup,
          totalAdvance,
          thirdPlace,
          fifthToEighth,
          classificationGroups,
          groupAssignment: groupSummary,
          message: `대회 "${input.name}" 생성 완료\n선수 ${players.length}명, ${groupCount}개 조, 예선 ${matchCount}경기 생성\n조당 ${advancePerGroup}명 본선 진출 (총 ${totalAdvance}명)\n순위결정전: 3/4위=${thirdPlace}, 5-8위=${fifthToEighth}, 하위순위=${classificationGroups}`,
        });
      }

      case "update_tournament": {
        const { tournamentId, ...fields } = input;
        const updates: Record<string, unknown> = { ...fields, updatedAt: Date.now() };
        delete updates.tournamentId;
        await db.ref(`tournaments/${tournamentId}`).update(updates);
        return JSON.stringify({ success: true, message: "대회 정보 수정 완료" });
      }

      case "delete_tournament": {
        const tid = input.tournamentId as string;
        const pin = input.adminPin as string;

        // 대회 존재 확인
        const tourCheck = await db.ref(`tournaments/${tid}`).once("value");
        if (!tourCheck.exists()) return JSON.stringify({ error: "대회를 찾을 수 없습니다." });

        // PIN 검증: admins/ 또는 config/adminPin에서 해시 조회
        const adminsSnap = await db.ref("admins").once("value");
        const configSnap = await db.ref("config/adminPin").once("value");
        let pinValid = false;

        if (adminsSnap.exists()) {
          for (const child of Object.values(adminsSnap.val() as Record<string, { pinHash: string }>)) {
            if (child.pinHash) {
              if (child.pinHash.includes(":")) {
                // PBKDF2: salt:hash
                const parts = child.pinHash.split(":");
                if (parts.length !== 2) continue;
                const [salt, storedHash] = parts;
                const derived = await hashPinPBKDF2(pin, salt);
                if (derived === `${salt}:${storedHash}`) { pinValid = true; break; }
              } else {
                // SHA-256 레거시
                const hash = await hashPinSHA256(pin);
                if (hash === child.pinHash) { pinValid = true; break; }
              }
            }
          }
        }
        if (!pinValid && configSnap.exists()) {
          const storedHash = configSnap.val() as string;
          const hash = await hashPinSHA256(pin);
          if (hash === storedHash) pinValid = true;
        }

        if (!pinValid) {
          return JSON.stringify({ error: "관리자 PIN이 올바르지 않습니다." });
        }

        // 대회 이름 조회
        const tourSnap = await db.ref(`tournaments/${tid}/name`).once("value");
        const tourName = tourSnap.exists() ? tourSnap.val() : tid;

        // 관련 데이터 모두 삭제
        const deletePaths: Record<string, null> = {
          [`tournaments/${tid}`]: null,
          [`matches/${tid}`]: null,
          [`tournamentPlayers/${tid}`]: null,
          [`schedule/${tid}`]: null,
          [`teams/${tid}`]: null,
        };
        await db.ref().update(deletePaths);

        return JSON.stringify({ success: true, message: `대회 "${tourName}" 및 관련 데이터(경기, 선수, 스케줄, 팀) 삭제 완료` });
      }

      // --- Write: Players ---
      case "add_players_bulk": {
        const players = input.players as Array<{ name: string; club?: string; class?: string; gender?: string }>;
        const basePath = input.tournamentId ? `tournamentPlayers/${input.tournamentId}` : "players";
        const now = Date.now();
        const bulk: Record<string, unknown> = {};
        const ids: string[] = [];
        for (const p of players) {
          const key = db.ref(basePath).push().key!;
          bulk[`${basePath}/${key}`] = { name: p.name, club: p.club || "", class: p.class || "", gender: p.gender || "", createdAt: now };
          ids.push(key);
        }
        await db.ref().update(bulk);
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

        const bulk: Record<string, unknown> = {};
        for (const m of matches) {
          const key = db.ref(`matches/${tid}`).push().key!;
          bulk[`matches/${tid}/${key}`] = m;
        }
        await db.ref().update(bulk);

        return JSON.stringify({ success: true, count: matches.length, message: `${matches.length}경기 라운드로빈 생성 완료` });
      }

      // --- Write: Schedule (고급) ---
      case "simulate_matches": {
        const tid = input.tournamentId as string;
        const stageId = input.stageId as string | undefined;
        const groupId = input.groupId as string | undefined;

        // 대회 설정에서 세트 수/점수 자동 로드
        const tourSnap = await db.ref(`tournaments/${tid}`).once("value");
        const tourData = tourSnap.exists() ? tourSnap.val() as Record<string, unknown> : {};
        const gameConfig = tourData.gameConfig as { winScore?: number; setsToWin?: number } | undefined;
        const winScore = Math.max(4, (input.winScore as number) || gameConfig?.winScore || 11);
        const setsToWin = Math.max(1, (input.setsToWin as number) || gameConfig?.setsToWin || 2);

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

        if (matchList.length === 0) return JSON.stringify({ error: "시뮬레이션할 경기가 없습니다. (선수가 배정된 pending 경기 없음)" });

        const bulk: Record<string, unknown> = {};
        const results: Array<{ match: string; score: string; winner: string }> = [];

        function simulateSet(ws: number): [number, number] {
          const safeWs = Math.max(4, ws);
          const deuce = Math.random() < 0.2;
          if (deuce) {
            const extra = Math.floor(Math.random() * 3);
            const winnerScore = safeWs + extra + 1;
            const loserScore = winnerScore - 2;
            return Math.random() > 0.5 ? [winnerScore, loserScore] : [loserScore, winnerScore];
          }
          const loserScore = 3 + Math.floor(Math.random() * Math.max(1, safeWs - 4));
          return Math.random() > 0.5 ? [safeWs, loserScore] : [loserScore, safeWs];
        }

        for (const [mid, match] of matchList) {
          const sets: Array<{ player1Score: number; player2Score: number; winnerId: string | null }> = [];
          let p1Wins = 0;
          let p2Wins = 0;

          while (p1Wins < setsToWin && p2Wins < setsToWin) {
            const [s1, s2] = simulateSet(winScore);
            const setWinner = s1 > s2
              ? (match.player1Id || match.team1Id) as string
              : (match.player2Id || match.team2Id) as string;
            sets.push({ player1Score: s1, player2Score: s2, winnerId: setWinner });
            if (s1 > s2) p1Wins++;
            else p2Wins++;
          }

          const winnerId = p1Wins > p2Wins
            ? (match.player1Id || match.team1Id) as string
            : (match.player2Id || match.team2Id) as string;
          const winnerName = p1Wins > p2Wins
            ? (match.player1Name || match.team1Name || "P1") as string
            : (match.player2Name || match.team2Name || "P2") as string;

          const scoreStr = sets.map(s => `${s.player1Score}-${s.player2Score}`).join(", ");
          results.push({ match: `${match.player1Name || match.team1Name} vs ${match.player2Name || match.team2Name}`, score: scoreStr, winner: winnerName });

          bulk[`matches/${tid}/${mid}/sets`] = sets;
          bulk[`matches/${tid}/${mid}/currentSet`] = sets.length - 1;
          bulk[`matches/${tid}/${mid}/status`] = "completed";
          bulk[`matches/${tid}/${mid}/winnerId`] = winnerId;
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
              const wName = (wId === srcM.player1Id ? srcM.player1Name : srcM.player2Name) as string;
              const lId = (wId === srcM.player1Id ? srcM.player2Id : srcM.player1Id) as string;
              const lName = (wId === srcM.player1Id ? srcM.player2Name : srcM.player1Name) as string;
              advanceBulk[`matches/${tid}/${nextId}/player1Id`] = isLoser ? lId : wId;
              advanceBulk[`matches/${tid}/${nextId}/player1Name`] = isLoser ? lName : wName;
              changed = true;
            }
            if (src2 && allM[src2]?.status === "completed" && (!nextMatch.player2Id || nextMatch.player2Id === "")) {
              const srcM = allM[src2];
              const wId = srcM.winnerId as string;
              const wName = (wId === srcM.player1Id ? srcM.player1Name : srcM.player2Name) as string;
              const lId = (wId === srcM.player1Id ? srcM.player2Id : srcM.player1Id) as string;
              const lName = (wId === srcM.player1Id ? srcM.player2Name : srcM.player1Name) as string;
              advanceBulk[`matches/${tid}/${nextId}/player2Id`] = isLoser ? lId : wId;
              advanceBulk[`matches/${tid}/${nextId}/player2Name`] = isLoser ? lName : wName;
              changed = true;
            }
            if (changed) advanceCount++;
          }

          if (Object.keys(advanceBulk).length > 0) {
            await db.ref().update(advanceBulk);
            results.push({ match: "자동 진출", score: "", winner: `${advanceCount}경기에 승자/패자 배치 완료` });
          }
        }

        return JSON.stringify({
          success: true,
          count: matchList.length,
          results: results.slice(0, 30),
          message: `${matchList.length}경기 시뮬레이션 완료`,
        });
      }

      case "generate_finals": {
        const tid = input.tournamentId as string;
        const tourSnap2 = await db.ref(`tournaments/${tid}`).once("value");
        if (!tourSnap2.exists()) return JSON.stringify({ error: "대회를 찾을 수 없습니다." });
        const tour2 = tourSnap2.val() as Record<string, unknown>;

        const finalsConfig2 = tour2.finalsConfig as Record<string, unknown> | undefined;
        const rankingConfig2 = tour2.rankingMatchConfig as Record<string, unknown> | undefined;
        const stages2 = (tour2.stages || []) as Array<Record<string, unknown>>;
        const qualStage2 = stages2.find(s => s.type === "qualifying");
        const finalsStageId2 = (stages2.find(s => s.type === "finals")?.id as string) || `stage_finals_${tid}`;
        const advancePerGroup2 = (input.advancePerGroup as number) || (finalsConfig2?.advancePerGroup as number) || 2;
        const includeThirdPlace2 = input.includeThirdPlace !== false && (rankingConfig2?.thirdPlace !== false);
        const includeFifthToEighth2 = (input.includeFifthToEighth as boolean) || (rankingConfig2?.fifthToEighth as boolean) || false;
        const includeClassification2 = (input.includeClassification as boolean) || (rankingConfig2?.classificationGroups as boolean) || false;

        // 예선 경기 로드
        const matchesSnap2 = await db.ref(`matches/${tid}`).once("value");
        if (!matchesSnap2.exists()) return JSON.stringify({ error: "경기가 없습니다." });
        const qualStageId2 = qualStage2?.id as string | undefined;
        const allMatches2 = Object.entries(matchesSnap2.val() as Record<string, Record<string, unknown>>);
        const qualMatches2 = allMatches2
          .map(([id, m]) => ({ id, ...m } as Record<string, unknown> & { id: string }))
          .filter((m) => m.status === "completed" && (qualStageId2 ? m.stageId === qualStageId2 : !!m.groupId));

        if (qualMatches2.length === 0) return JSON.stringify({ error: "완료된 예선 경기가 없습니다." });

        // 조별 순위 계산
        const gStats = new Map<string, Map<string, { id: string; name: string; wins: number; sd: number; pd: number }>>();
        for (const m of qualMatches2) {
          const gid = m.groupId as string;
          if (!gid) continue;
          if (!gStats.has(gid)) gStats.set(gid, new Map());
          const st = gStats.get(gid)!;
          const p1Id = (m.player1Id || m.team1Id) as string;
          const p2Id = (m.player2Id || m.team2Id) as string;
          if (!st.has(p1Id)) st.set(p1Id, { id: p1Id, name: (m.player1Name || m.team1Name) as string, wins: 0, sd: 0, pd: 0 });
          if (!st.has(p2Id)) st.set(p2Id, { id: p2Id, name: (m.player2Name || m.team2Name) as string, wins: 0, sd: 0, pd: 0 });
          const s1 = st.get(p1Id)!;
          const s2 = st.get(p2Id)!;
          if (m.winnerId === p1Id) s1.wins++; else if (m.winnerId === p2Id) s2.wins++;
          for (const s of ((m.sets || []) as Array<{ player1Score: number; player2Score: number }>)) {
            s1.pd += s.player1Score - s.player2Score; s2.pd += s.player2Score - s.player1Score;
            if (s.player1Score > s.player2Score) { s1.sd++; s2.sd--; } else if (s.player2Score > s.player1Score) { s2.sd++; s1.sd--; }
          }
        }

        const advanced: Array<{ id: string; name: string; gid: string; rank: number }> = [];
        const eliminated: Array<{ id: string; name: string; gid: string; rank: number }> = [];
        const gids = [...gStats.keys()].sort();
        for (const gid of gids) {
          const sorted = [...gStats.get(gid)!.values()].sort((a, b) => b.wins - a.wins || b.sd - a.sd || b.pd - a.pd || a.name.localeCompare(b.name));
          sorted.forEach((p, i) => (i < advancePerGroup2 ? advanced : eliminated).push({ id: p.id, name: p.name, gid, rank: i + 1 }));
        }

        if (advanced.length < 2) return JSON.stringify({ error: `진출자 ${advanced.length}명. 최소 2명 필요.` });

        // 교차 시드 배치 (A조1 vs H조2, B조1 vs G조2, ...)
        const top = advanced.filter(p => p.rank === 1);
        const sec = advanced.filter(p => p.rank === 2);
        const r1: Array<[typeof advanced[0], typeof advanced[0]]> = [];
        for (let i = 0; i < top.length; i++) {
          const opp = sec[top.length - 1 - i];
          if (opp) r1.push([top[i], opp]);
        }
        const used = new Set(r1.flatMap(([a, b]) => [a.id, b.id]));
        const left = advanced.filter(p => !used.has(p.id));
        for (let i = 0; i < left.length - 1; i += 2) r1.push([left[i], left[i + 1]]);

        // 전체 브라켓 생성 (모든 라운드)
        const now2 = Date.now();
        const bulk2: Record<string, unknown> = {};
        let mc = 0;
        const summary: string[] = [];

        const ROUND_NAMES: Record<number, string> = { 16: "16강", 8: "8강", 4: "4강", 2: "결승" };
        const getRoundName = (n: number) => ROUND_NAMES[n] || `${n}강`;

        // 라운드별 matchKey 추적 (승자 연결용)
        const roundMatchKeys: string[][] = [];

        // 1라운드: 실제 선수 배치
        const r1Keys: string[] = [];
        summary.push(`\n[ ${getRoundName(r1.length * 2)} ] ${r1.length}경기`);
        for (let i = 0; i < r1.length; i++) {
          const [p1, p2] = r1[i];
          const mKey = db.ref(`matches/${tid}`).push().key!;
          bulk2[`matches/${tid}/${mKey}`] = {
            tournamentId: tid, type: tour2.type || "individual", status: "pending",
            round: 1, bracketPosition: i, bracketRound: getRoundName(r1.length * 2),
            stageId: finalsStageId2,
            player1Id: p1.id, player2Id: p2.id,
            player1Name: p1.name, player2Name: p2.name,
            sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
            currentSet: 0, player1Timeouts: 0, player2Timeouts: 0,
            winnerId: null, createdAt: now2 + mc,
          };
          summary.push(`  ${i + 1}. ${p1.name}(${p1.gid}${p1.rank}위) vs ${p2.name}(${p2.gid}${p2.rank}위)`);
          r1Keys.push(mKey);
          mc++;
        }
        roundMatchKeys.push(r1Keys);

        // 후속 라운드: 빈 슬롯 생성 (8강→4강→결승)
        let prevCount = r1.length;
        let roundNum = 2;
        while (prevCount > 1) {
          const nextCount = Math.floor(prevCount / 2);
          const rName = getRoundName(nextCount * 2 > 2 ? nextCount * 2 : 2);
          const rKeys: string[] = [];
          summary.push(`\n[ ${rName} ] ${nextCount}경기`);
          for (let i = 0; i < nextCount; i++) {
            const mKey = db.ref(`matches/${tid}`).push().key!;
            const prevRName = getRoundName(prevCount * 2 > 2 ? prevCount * 2 : prevCount);
            bulk2[`matches/${tid}/${mKey}`] = {
              tournamentId: tid, type: tour2.type || "individual", status: "pending",
              round: roundNum, bracketPosition: i, bracketRound: rName,
              stageId: finalsStageId2,
              player1Id: "", player2Id: "",
              player1Name: `${prevRName} 승자${i * 2 + 1}`, player2Name: `${prevRName} 승자${i * 2 + 2}`,
              sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
              currentSet: 0, player1Timeouts: 0, player2Timeouts: 0,
              winnerId: null, createdAt: now2 + mc,
              // 이전 라운드 매치 참조 (승자 자동 배치용)
              sourceMatch1: roundMatchKeys[roundMatchKeys.length - 1][i * 2],
              sourceMatch2: roundMatchKeys[roundMatchKeys.length - 1][i * 2 + 1],
            };
            summary.push(`  ${i + 1}. ${prevRName} 승자${i * 2 + 1} vs ${prevRName} 승자${i * 2 + 2}`);
            rKeys.push(mKey);
            mc++;
          }
          roundMatchKeys.push(rKeys);
          prevCount = nextCount;
          roundNum++;
        }

        // 3/4위 결정전
        if (includeThirdPlace2 && r1.length >= 4) {
          const sfKeys = roundMatchKeys[roundMatchKeys.length - 2]; // 4강 키
          const mKey = db.ref(`matches/${tid}`).push().key!;
          bulk2[`matches/${tid}/${mKey}`] = {
            tournamentId: tid, type: tour2.type || "individual", status: "pending",
            round: roundNum, bracketRound: "3/4위", stageId: `${finalsStageId2}_3rd`,
            player1Id: "", player2Id: "", player1Name: "4강 패자1", player2Name: "4강 패자2",
            sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
            currentSet: 0, player1Timeouts: 0, player2Timeouts: 0,
            winnerId: null, createdAt: now2 + mc,
            sourceMatch1: sfKeys?.[0], sourceMatch2: sfKeys?.[1], sourceType: "loser",
          };
          summary.push("\n[ 3/4위 결정전 ] 1경기");
          mc++;
        }

        // 5-8위 결정전
        if (includeFifthToEighth2 && r1.length >= 4) {
          const qfKeys = roundMatchKeys.length >= 3 ? roundMatchKeys[roundMatchKeys.length - 3] : roundMatchKeys[0]; // 8강 키
          for (let i = 0; i < 2; i++) {
            const mKey = db.ref(`matches/${tid}`).push().key!;
            bulk2[`matches/${tid}/${mKey}`] = {
              tournamentId: tid, type: tour2.type || "individual", status: "pending",
              round: roundNum, bracketRound: "5-8위", stageId: `${finalsStageId2}_5to8`,
              player1Id: "", player2Id: "",
              player1Name: `8강 패자${i * 2 + 1}`, player2Name: `8강 패자${i * 2 + 2}`,
              sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
              currentSet: 0, player1Timeouts: 0, player2Timeouts: 0,
              winnerId: null, createdAt: now2 + mc,
              sourceMatch1: qfKeys?.[i * 2], sourceMatch2: qfKeys?.[i * 2 + 1], sourceType: "loser",
            };
            mc++;
          }
          summary.push("[ 5-8위 결정전 ] 2경기");
        }

        // 하위 순위 결정전
        if (includeClassification2 && eliminated.length >= 2) {
          const gs = 4;
          const gc = Math.ceil(eliminated.length / gs);
          let cmc = 0;
          for (let g = 0; g < gc; g++) {
            const gp = eliminated.slice(g * gs, (g + 1) * gs);
            for (let i = 0; i < gp.length; i++) {
              for (let j = i + 1; j < gp.length; j++) {
                const mKey = db.ref(`matches/${tid}`).push().key!;
                bulk2[`matches/${tid}/${mKey}`] = {
                  tournamentId: tid, type: tour2.type || "individual", status: "pending",
                  round: cmc + 1, stageId: `${finalsStageId2}_class_${g}`,
                  bracketRound: `하위${g + 1}조`,
                  player1Id: gp[i].id, player2Id: gp[j].id,
                  player1Name: gp[i].name, player2Name: gp[j].name,
                  sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
                  currentSet: 0, player1Timeouts: 0, player2Timeouts: 0,
                  winnerId: null, createdAt: now2 + mc,
                };
                mc++; cmc++;
              }
            }
          }
          summary.push(`\n[ 하위 순위 결정전 ] ${gc}그룹, ${cmc}경기`);
        }

        await db.ref().update(bulk2);

        // 조별 순위
        const gRank = gids.map(gid => {
          const s = [...gStats.get(gid)!.values()].sort((a, b) => b.wins - a.wins || b.sd - a.sd);
          return `${gid}: ${s.map((p, i) => `${i + 1}.${p.name}(${p.wins}승)`).join(", ")}`;
        }).join("\n");

        return JSON.stringify({
          success: true, matchCount: mc,
          advancedCount: advanced.length, eliminatedCount: eliminated.length,
          structure: summary.join("\n"), groupRankings: gRank,
          message: `본선 ${mc}경기 생성 완료\n${summary.join("\n")}`,
        });
      }

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
        if (breakStart >= 0 && breakEnd >= 0 && breakStart >= breakEnd) {
          return JSON.stringify({ error: `휴식 시작(${breakStartStr})이 종료(${breakEndStr})보다 같거나 늦습니다.` });
        }
        if (dayStart >= dayEnd) {
          return JSON.stringify({ error: `시작 시간(${startTime})이 종료 시간(${endTime})보다 같거나 늦습니다.` });
        }

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

          // 경기 업데이트는 아래에서 일괄 처리

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

        // 일괄 쓰기: 경기 업데이트 + 스케줄 저장
        const scheduleBulk: Record<string, unknown> = {};
        for (const slot of slots) {
          const mid = slot.matchId as string;
          scheduleBulk[`matches/${tid}/${mid}/scheduledTime`] = slot.scheduledTime;
          scheduleBulk[`matches/${tid}/${mid}/scheduledDate`] = slot.scheduledDate;
          scheduleBulk[`matches/${tid}/${mid}/courtId`] = slot.courtId;
          scheduleBulk[`matches/${tid}/${mid}/courtName`] = slot.courtName;
        }

        if (!onlyUnassigned) {
          scheduleBulk[`schedule/${tid}`] = null; // 기존 삭제
        }
        await db.ref().update(scheduleBulk);

        // 스케줄 슬롯 저장
        const slotBulk: Record<string, unknown> = {};
        if (onlyUnassigned) {
          const existingSnap = await db.ref(`schedule/${tid}`).once("value");
          if (existingSnap.exists()) {
            existingSnap.forEach((child) => { slotBulk[`schedule/${tid}/${child.key}`] = child.val(); });
          }
        }
        for (const slot of slots) {
          const key = db.ref(`schedule/${tid}`).push().key!;
          slotBulk[`schedule/${tid}/${key}`] = slot;
        }
        await db.ref().update(slotBulk);

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

        // 시간 시프트 + 날짜 경계 처리
        function shiftTime(time: string, date: string | undefined, shiftMin: number): { time: string; date: string | undefined; dateShift: number } {
          const [h2, m2] = time.split(":").map(Number);
          let totalMin = h2 * 60 + m2 + shiftMin;
          let ds = 0;
          while (totalMin < 0) { totalMin += 24 * 60; ds--; }
          while (totalMin >= 24 * 60) { totalMin -= 24 * 60; ds++; }
          const newTime2 = `${String(Math.floor(totalMin / 60)).padStart(2, "0")}:${String(totalMin % 60).padStart(2, "0")}`;
          const newDate2 = ds !== 0 && date ? addDays(date, ds) : date;
          return { time: newTime2, date: newDate2, dateShift: ds };
        }

        const shiftBulk: Record<string, unknown> = {};
        let count = 0;
        const allMatches = matchesSnap.val() as Record<string, Record<string, unknown>>;
        for (const [mid, match] of Object.entries(allMatches)) {
          if (!match.scheduledTime) continue;
          if (matchIds && matchIds.length > 0 && !matchIds.includes(mid)) continue;
          if (courtId && match.courtId !== courtId) continue;

          const result = shiftTime(match.scheduledTime as string, match.scheduledDate as string | undefined, shift);
          shiftBulk[`matches/${tid}/${mid}/scheduledTime`] = result.time;
          if (result.date) shiftBulk[`matches/${tid}/${mid}/scheduledDate`] = result.date;
          count++;
        }

        const schedSnap = await db.ref(`schedule/${tid}`).once("value");
        if (schedSnap.exists()) {
          for (const [sid, slot] of Object.entries(schedSnap.val() as Record<string, Record<string, unknown>>)) {
            if (!slot.scheduledTime) continue;
            const matchId = slot.matchId as string;
            if (matchIds && matchIds.length > 0 && !matchIds.includes(matchId)) continue;
            if (courtId && slot.courtId !== courtId) continue;

            const result = shiftTime(slot.scheduledTime as string, slot.scheduledDate as string | undefined, shift);
            shiftBulk[`schedule/${tid}/${sid}/scheduledTime`] = result.time;
            if (result.date) shiftBulk[`schedule/${tid}/${sid}/scheduledDate`] = result.date;
          }
        }
        if (Object.keys(shiftBulk).length > 0) await db.ref().update(shiftBulk);

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
