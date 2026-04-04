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
  /* INTERNAL - called by workflow tools
  {
    name: "create_tournament",
    description: "단순 대회 생성 (조편성/대진 없음). 복잡한 대회는 setup_full_tournament 사용. 동일 이름 대회 중복 생성 차단.",
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
  */
  /* INTERNAL - called by workflow tools
  {
    name: "setup_full_tournament",
    description: "대회 생성. type=individual(개인전): players 사용. type=team(팀전/팀 리그전): teams 사용. teams 예시: [{name:'전남', memberNames:['안윤환','이종경','박다슬'], coachName:'고성순'}]. 사용자가 지정한 팀 구성을 그대로 teams에 전달. 코치는 coachName, memberNames에 넣지 않음. 동일 이름 중복 차단.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "대회 이름" },
        date: { type: "string", description: "시작일 YYYY-MM-DD" },
        endDate: { type: "string", description: "종료일 (선택)" },
        type: { type: "string", enum: ["individual", "team"], description: "individual=개인전, team=팀전(팀 리그전 포함). 팀전 시 반드시 teams 파라미터로 팀별 선수 전달." },
        players: { type: "array", items: { type: "object", properties: { name: { type: "string" }, club: { type: "string" }, class: { type: "string" }, gender: { type: "string" } }, required: ["name"] }, description: "개인전 선수 목록" },
        teams: { type: "array", items: { type: "object", properties: { name: { type: "string" }, memberNames: { type: "array", items: { type: "string" } }, coachName: { type: "string" } }, required: ["name"] }, description: "팀전 팀 목록 (팀 이름 + 팀원 + 코치)" },
        groupCount: { type: "number", description: "조 수 (예: 8)" },
        advancePerGroup: { type: "number", description: "조당 본선 진출 수 (예: 2)" },
        seeds: { type: "array", items: { type: "string" }, description: "탑시드 이름 (개인전: 선수명, 팀전: 팀명)" },
        qualifyingWinScore: { type: "number", description: "예선 승리 점수 (개인전 기본 11, 팀전 기본 31)" },
        qualifyingSetsToWin: { type: "number", description: "예선 세트 (3세트=2, 5세트=3, 팀전 기본 1)" },
        finalsFormat: { type: "string", enum: ["single_elimination", "double_elimination"], description: "본선 방식" },
        thirdPlace: { type: "boolean", description: "3/4위 결정전" },
        fifthToEighth: { type: "boolean", description: "5~8위 결정전" },
        classificationGroups: { type: "boolean", description: "하위 순위 결정전" },
      },
      required: ["name", "date", "type", "groupCount"],
    },
  },
  */
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
    description: "대회+경기+선수+스케줄+팀 전부 삭제. 관리자 PIN 필수(사용자에게 물어볼 것). SHA-256/PBKDF2 검증. 동일 이름 대회 존재 확인.",
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
    description: "경기 1개 추가. 팀전이면 matchType='team' + team1Id/team2Id/team1Name/team2Name 사용.",
    input_schema: {
      type: "object" as const,
      properties: {
        tournamentId: { type: "string" },
        matchType: { type: "string", enum: ["individual", "team"], description: "경기 타입 (기본 individual)" },
        player1Id: { type: "string", description: "개인전: 선수1 ID" },
        player2Id: { type: "string", description: "개인전: 선수2 ID" },
        player1Name: { type: "string", description: "개인전: 선수1 이름" },
        player2Name: { type: "string", description: "개인전: 선수2 이름" },
        team1Id: { type: "string", description: "팀전: 팀1 ID" },
        team2Id: { type: "string", description: "팀전: 팀2 ID" },
        team1Name: { type: "string", description: "팀전: 팀1 이름" },
        team2Name: { type: "string", description: "팀전: 팀2 이름" },
        round: { type: "number" },
        groupId: { type: "string" },
        stageId: { type: "string" },
      },
      required: ["tournamentId"],
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
  /* INTERNAL - called by workflow tools
  {
    name: "generate_round_robin",
    description: "라운드로빈 대진 자동 생성. 개인전: playerIds 사용, 팀전: teamIds 사용. 대회 type을 자동 감지하여 팀전이면 팀 매치(team1Id/team2Id), 개인전이면 개인 매치(player1Id/player2Id) 생성.",
    input_schema: {
      type: "object" as const,
      properties: {
        tournamentId: { type: "string" },
        playerIds: { type: "array", items: { type: "string" }, description: "선수 ID 배열 (개인전용, 비어있으면 대회 전체 선수)" },
        teamIds: { type: "array", items: { type: "string" }, description: "팀 ID 배열 (팀전용, 비어있으면 대회 전체 팀)" },
        groupId: { type: "string", description: "조 ID (선택)" },
      },
      required: ["tournamentId"],
    },
  },
  */

  // --- Write: Schedule ---
  /* INTERNAL - called by workflow tools
  {
    name: "generate_schedule",
    description: "고급 스케줄 자동 생성. 지원: 선수 휴식(playerRestMinutes, 기본60분), 점심시간 제외(breakStart/End), 일일 마감(endTime)+다음날(nextDayStartTime), 코트별 배정, 심판 자동 라운드로빈 배정, 미배정만(onlyUnassigned), 스테이지 필터(stageFilter).",
    input_schema: {
      type: "object" as const,
      properties: {
        tournamentId: { type: "string" },
        startTime: { type: "string", description: "HH:MM (기본 09:00)" },
        endTime: { type: "string", description: "HH:MM (기본 19:00)" },
        intervalMinutes: { type: "number", description: "코트별 경기 간격 (기본 30분). 경기 시간에 맞춰 설정 (예: 경기 60분이면 60 이상)" },
        playerRestMinutes: { type: "number", description: "팀/선수 최소 휴식 시간 (기본 60분). 경기 종료 후 다음 경기까지 최소 간격. 예: 경기 60분 + 팀당 간격 30분이면 90 입력" },
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
  */
  /* INTERNAL - called by workflow tools
  {
    name: "simulate_matches",
    description: "사용자가 '시뮬레이션/경기 진행/결과'를 요청할 때만 호출. pending 경기를 현실적 점수로 완료. 코인토스→워밍업→서브교대→사이드체인지(팀16점/개인6점)→타임아웃 자동 기록. 팀전: 31점 1세트, 개인전: 대회 설정. 빈 슬롯(선수 미배정) 자동 제외. 완료 후 다음 라운드에 승자 자동 배치.",
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
  */
  /* INTERNAL - called by workflow tools
  {
    name: "generate_finals",
    description: "예선 완료 후 호출. 조별 순위 자동 계산(승→세트득실→점수득실)→진출자 추출→교차 시드(A1위 vs B2위)→전체 브라켓(16강→8강→4강→결승) + 3/4위/5-8위/하위순위 결정전. 팀전도 지원(team1Id/team2Id 자동 설정). 빈 슬롯에 sourceMatch 참조로 승자 자동 진출.",
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
  */
  {
    name: "shift_schedule",
    description: "스케줄 일괄 시간 이동(분). 양수=뒤로, 음수=앞으로. courtId로 특정 코트만 가능. 자정 넘으면 날짜 자동 변경.",
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
  /* INTERNAL - called by workflow tools
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
  */
  /* INTERNAL - called by workflow tools
  {
    name: "add_referee",
    description: "심판 추가. 동일 이름 자동 중복 방지(기존 ID 반환). role: main(주심)/assistant(부심).",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string" },
        role: { type: "string", enum: ["main", "assistant"], description: "main(주심) or assistant(부심)" },
      },
      required: ["name"],
    },
  },
  */
  {
    name: "delete_referee",
    description: "심판 삭제.",
    input_schema: {
      type: "object" as const,
      properties: { refereeId: { type: "string" } },
      required: ["refereeId"],
    },
  },
  {
    name: "update_referee",
    description: "심판 정보 수정.",
    input_schema: {
      type: "object" as const,
      properties: { refereeId: { type: "string" }, name: { type: "string" }, role: { type: "string", enum: ["main", "assistant"] } },
      required: ["refereeId"],
    },
  },
  {
    name: "delete_court",
    description: "코트 삭제.",
    input_schema: {
      type: "object" as const,
      properties: { courtId: { type: "string" } },
      required: ["courtId"],
    },
  },
  {
    name: "update_court",
    description: "코트 정보 수정.",
    input_schema: {
      type: "object" as const,
      properties: { courtId: { type: "string" }, name: { type: "string" }, location: { type: "string" } },
      required: ["courtId"],
    },
  },
  {
    name: "update_player",
    description: "선수 정보 수정.",
    input_schema: {
      type: "object" as const,
      properties: {
        playerId: { type: "string" }, tournamentId: { type: "string", description: "대회 ID (선택, 없으면 전역)" },
        name: { type: "string" }, club: { type: "string" }, class: { type: "string" }, gender: { type: "string" },
      },
      required: ["playerId"],
    },
  },
  /* INTERNAL - called by workflow tools
  {
    name: "bulk_assign_referees",
    description: "미배정 경기에 등록된 심판을 라운드로빈으로 자동 배정. 이미 심판이 있는 경기는 건너뜀.",
    input_schema: {
      type: "object" as const,
      properties: { tournamentId: { type: "string" } },
      required: ["tournamentId"],
    },
  },
  */
  {
    name: "reset_schedule",
    description: "대회의 모든 스케줄 초기화 (경기의 시간/코트 배정 제거).",
    input_schema: {
      type: "object" as const,
      properties: { tournamentId: { type: "string" } },
      required: ["tournamentId"],
    },
  },
  {
    name: "add_team",
    description: "팀 추가 (팀전 대회용). coachName으로 코치 이름 등록 가능.",
    input_schema: {
      type: "object" as const,
      properties: {
        tournamentId: { type: "string" },
        name: { type: "string", description: "팀 이름" },
        memberIds: { type: "array", items: { type: "string" }, description: "팀원 선수 ID 배열" },
        memberNames: { type: "array", items: { type: "string" }, description: "팀원 이름 배열" },
        coachName: { type: "string", description: "코치 이름 (선택)" },
      },
      required: ["tournamentId", "name"],
    },
  },
  {
    name: "delete_team",
    description: "팀 삭제.",
    input_schema: {
      type: "object" as const,
      properties: { tournamentId: { type: "string" }, teamId: { type: "string" } },
      required: ["tournamentId", "teamId"],
    },
  },
  {
    name: "list_teams",
    description: "팀 목록 조회.",
    input_schema: {
      type: "object" as const,
      properties: { tournamentId: { type: "string" } },
      required: ["tournamentId"],
    },
  },
  // ===== 워크플로우 도구 (원스톱) =====
  {
    name: "create_team_league",
    description: "팀전/팀 리그전 원스톱 생성. 사용자가 지정한 팀 구성을 그대로 전달. 대회 생성→코트 등록→심판 등록→스케줄 생성→심판 배정까지 한번에 처리. 결과에 팀 명단, 조 편성, 스케줄 상세가 포함됨.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "대회 이름" },
        date: { type: "string", description: "시작일 YYYY-MM-DD" },
        endDate: { type: "string", description: "종료일 YYYY-MM-DD (선택)" },
        groupId: { type: "string", description: "대회 그룹 ID. 같은 대회 안에서 남자부/여자부 등 카테고리를 묶을 때 사용. 같은 groupId를 가진 대회끼리 그룹으로 표시됨." },
        groupName: { type: "string", description: "대회 그룹 이름 (예: '2026 전국체전'). groupId 사용 시 필수." },
        scheduleDates: { type: "array", items: { type: "string" }, description: "경기 진행 날짜 목록 (여러 주에 걸쳐 진행 시). 예: ['2026-04-05','2026-04-12','2026-04-19']" },
        teams: { type: "array", items: { type: "object", properties: { name: { type: "string" }, memberNames: { type: "array", items: { type: "string" } }, coachName: { type: "string" } }, required: ["name", "memberNames"] }, description: "팀 목록. 사용자가 지정한 대로 전달. 예: [{name:'전남', memberNames:['안윤환','이종경'], coachName:'고성순'}]" },
        randomTeam: { type: "boolean", description: "랜덤 팀 구성 (true면 randomTeamLeague 타입으로 생성)" },
        groupCount: { type: "number", description: "조 수 (기본 2)" },
        advancePerGroup: { type: "number", description: "조당 본선 진출 수 (기본 2)" },
        wildcardCount: { type: "number", description: "와일드카드 수. 전체 조에서 성적 우수 차순위 N명 추가 진출 (예: 8조×2명+와일드카드1=17명 중 16강)" },
        format: { type: "string", enum: ["full_league", "group_knockout"], description: "대회 방식. 풀리그=full_league, 조별리그+결승=group_knockout (기본 group_knockout)" },
        courts: { type: "array", items: { type: "string" }, description: "경기장 이름 목록 (예: ['레벨업실','심쿵실'])" },
        referees: { type: "array", items: { type: "string" }, description: "심판 이름 목록 (예: ['이선영','임옥화'])" },
        startTime: { type: "string", description: "시작 시간 (기본 09:00)" },
        endTime: { type: "string", description: "종료 시간 (기본 18:00)" },
        nextDayStartTime: { type: "string", description: "다음날 시작 시간 (선택)" },
        matchDurationMinutes: { type: "number", description: "경기 시간 분 (기본 60)" },
        teamRestMinutes: { type: "number", description: "팀당 경기 간격 분 (기본 30)" },
        breakStart: { type: "string", description: "휴식(점심) 시작 시간 HH:MM (예: 12:00)" },
        breakEnd: { type: "string", description: "휴식(점심) 종료 시간 HH:MM (예: 13:00)" },
        // 팀 세부 설정
        teamSize: { type: "number", description: "팀원 수 (기본 3)" },
        maxReserves: { type: "number", description: "후보선수 수 (기본 1)" },
        genderRatio: { type: "object", properties: { male: { type: "number" }, female: { type: "number" } }, description: "성비 설정 (예: {male:2, female:1})" },
        rotationEnabled: { type: "boolean", description: "로테이션 사용 여부 (기본 false)" },
        rotationInterval: { type: "number", description: "로테이션 간격 (기본 6)" },
        // 본선 설정
        finalsFormat: { type: "string", enum: ["single_elimination", "double_elimination", "round_robin"], description: "본선 방식 (기본 single_elimination)" },
        finalsStartRound: { type: "number", description: "본선 시작 라운드 (4/8/16/32, 기본=진출자 수)" },
        avoidSameGroup: { type: "boolean", description: "같은 조 회피 (기본 true)" },
        bracketArrangement: { type: "string", enum: ["cross_group", "sequential", "custom"], description: "대진 배정 방식 (기본 cross_group)" },
        // 순위 결정전
        thirdPlace: { type: "boolean", description: "3/4위 결정전 (기본 true)" },
        fifthToEighth: { type: "boolean", description: "5~8위 결정전 (기본 true)" },
        fifthToEighthFormat: { type: "string", enum: ["simple", "full", "round_robin"], description: "5~8위 결정전 방식 (기본 simple)" },
        classificationGroups: { type: "boolean", description: "하위 순위 결정전 (기본 false)" },
        classificationGroupSize: { type: "number", description: "하위 순위 그룹 크기 (기본 4)" },
        rankingUpTo: { type: "number", description: "순위 결정전 범위. N위까지만 순위 산출 (예: 6이면 6위까지만). 0이면 제한 없음." },
        // 득점 설정
        qualifyingWinScore: { type: "number", description: "예선 승리 점수 (기본 31)" },
        seeds: { type: "array", items: { type: "string" }, description: "탑시드 팀명 목록" },
        tiebreakerRules: { type: "array", items: { type: "string", enum: ["head_to_head", "set_difference", "point_difference", "points_for"] }, description: "타이브레이커 우선순위 (기본 ['set_difference','point_difference'])" },
      },
      required: ["name", "date", "teams"],
    },
  },
  {
    name: "create_individual_tournament",
    description: "개인전 원스톱 생성. 대회 생성→코트 등록→심판 등록→스케줄 생성→심판 배정까지 한번에 처리. 풀리그는 format='full_league'로 설정.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "대회 이름" },
        date: { type: "string", description: "시작일 YYYY-MM-DD" },
        endDate: { type: "string", description: "종료일 (선택)" },
        scheduleDates: { type: "array", items: { type: "string" }, description: "경기 진행 날짜 목록 (여러 주에 걸쳐 진행 시). 예: ['2026-04-05','2026-04-12']" },
        players: { type: "array", items: { type: "object", properties: { name: { type: "string" }, gender: { type: "string" }, club: { type: "string" }, class: { type: "string" } }, required: ["name"] }, description: "선수 목록" },
        format: { type: "string", enum: ["full_league", "group_knockout"], description: "대회 방식. 풀리그=full_league, 조별리그+결승=group_knockout (기본 group_knockout)" },
        groupCount: { type: "number", description: "조 수 (풀리그는 1, 조별리그 기본 4)" },
        advancePerGroup: { type: "number", description: "조당 본선 진출 수 (기본 2)" },
        wildcardCount: { type: "number", description: "와일드카드 수. 전체 조에서 성적 우수 차순위 N명 추가 진출 (예: 8조×2명+와일드카드1=17명)" },
        courts: { type: "array", items: { type: "string" }, description: "경기장 이름 목록" },
        referees: { type: "array", items: { type: "string" }, description: "심판 이름 목록" },
        startTime: { type: "string", description: "시작 시간 (기본 09:00)" },
        endTime: { type: "string", description: "종료 시간 (기본 18:00)" },
        nextDayStartTime: { type: "string", description: "다음날 시작 시간 (선택)" },
        matchDurationMinutes: { type: "number", description: "경기 시간 분 (기본 30)" },
        playerRestMinutes: { type: "number", description: "선수 경기 간격 분 (기본 30)" },
        breakStart: { type: "string", description: "휴식(점심) 시작 시간 HH:MM (예: 12:00)" },
        breakEnd: { type: "string", description: "휴식(점심) 종료 시간 HH:MM (예: 13:00)" },
        // 득점 설정
        setsToWin: { type: "number", description: "예선 세트 수 (3세트=2, 5세트=3, 기본 2)" },
        winScore: { type: "number", description: "승리 점수 (기본 11)" },
        // 본선 설정
        finalsFormat: { type: "string", enum: ["single_elimination", "double_elimination", "round_robin"], description: "본선 방식 (기본 single_elimination)" },
        finalsStartRound: { type: "number", description: "본선 시작 라운드 (4/8/16/32)" },
        finalsSetsToWin: { type: "number", description: "본선 세트 수 (예선과 다를 경우)" },
        avoidSameGroup: { type: "boolean", description: "같은 조 회피 (기본 true)" },
        bracketArrangement: { type: "string", enum: ["cross_group", "sequential", "custom"], description: "대진 배정 방식 (기본 cross_group)" },
        // 순위 결정전
        thirdPlace: { type: "boolean", description: "3/4위 결정전 (기본 true)" },
        fifthToEighth: { type: "boolean", description: "5~8위 결정전 (기본 false)" },
        fifthToEighthFormat: { type: "string", enum: ["simple", "full", "round_robin"], description: "5~8위 결정전 방식 (기본 simple)" },
        classificationGroups: { type: "boolean", description: "하위 순위 결정전 (기본 false)" },
        classificationGroupSize: { type: "number", description: "하위 순위 그룹 크기 (기본 4)" },
        rankingUpTo: { type: "number", description: "순위 결정전 범위. N위까지만 순위 산출 (예: 6이면 6위까지만). 0이면 제한 없음." },
        seeds: { type: "array", items: { type: "string" }, description: "탑시드 선수명 목록" },
        tiebreakerRules: { type: "array", items: { type: "string", enum: ["head_to_head", "set_difference", "point_difference", "points_for"] }, description: "타이브레이커 우선순위 (기본 ['set_difference','point_difference'])" },
        // 라운드별 세트 오버라이드
        roundOverrideFromRound: { type: "number", description: "세트 수 변경 시작 라운드 (4강=4, 결승=2)" },
        roundOverrideSetsToWin: { type: "number", description: "변경될 세트 수 (5세트=3)" },
      },
      required: ["name", "date", "players"],
    },
  },
  {
    name: "run_full_simulation",
    description: "전체 시뮬레이션. tournamentId만 전달하면 자동 처리. 풀리그는 리그전만, 조별리그는 예선→결승까지 진행. 결과에 순위, 본선 결과, 팀 로스터 포함.",
    input_schema: {
      type: "object" as const,
      properties: {
        tournamentId: { type: "string", description: "대회 ID" },
      },
      required: ["tournamentId"],
    },
  },
];

// ===== Tool Executor =====

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  // 도구 이름 검증: TOOL_DEFINITIONS에 없고 내부 도구도 아닌 호출 차단
  const validNames = new Set(TOOL_DEFINITIONS.map(t => t.name));
  const internalTools = new Set([
    "create_tournament", "setup_full_tournament", "generate_round_robin",
    "generate_schedule", "simulate_matches", "generate_finals",
    "add_court", "add_referee", "bulk_assign_referees",
  ]);
  if (!validNames.has(name) && !internalTools.has(name)) {
    return JSON.stringify({ error: `"${name}" 도구는 존재하지 않습니다. 사용 가능한 도구: ${[...validNames].join(", ")}` });
  }
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
        if (!snap.exists()) return JSON.stringify({ matches: [], summary: "경기 없음" });
        type ME = Record<string, unknown> & { id: string };
        const rawList: ME[] = Object.entries(snap.val()).map(([id, v]) => ({ id, ...(v as Record<string, unknown>) }));
        let filtered = rawList;
        if (input.status) filtered = filtered.filter(m => m.status === input.status);

        // 요약 통계
        const total = rawList.length;
        const pending = rawList.filter(m => m.status === "pending").length;
        const completed = rawList.filter(m => m.status === "completed").length;
        const inProgress = rawList.filter(m => m.status === "in_progress").length;

        // 경기별 핵심 정보만 (토큰 절약)
        const compact = filtered.slice(0, 50).map(m => {
          const sets = (m.sets || []) as Array<{ player1Score: number; player2Score: number }>;
          const score = sets.map(s => `${s.player1Score}-${s.player2Score}`).join(", ");
          return {
            id: m.id, status: m.status, round: m.round,
            p1: m.player1Name || m.team1Name || "", p2: m.player2Name || m.team2Name || "",
            score, winnerId: m.winnerId,
            groupId: m.groupId, stageId: m.stageId,
            bracketRound: m.bracketRound,
          };
        });

        return JSON.stringify({ matches: compact, summary: `전체 ${total}경기 (완료 ${completed}, 진행 ${inProgress}, 대기 ${pending})` });
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
        // 동일 이름 대회 중복 방지
        if (input.name) {
          const ctExisting = await db.ref("tournaments").once("value");
          if (ctExisting.exists()) {
            for (const [eid, ev] of Object.entries(ctExisting.val() as Record<string, { name?: string }>)) {
              if (ev.name === input.name) {
                return JSON.stringify({ error: `"${input.name}" 대회가 이미 존재합니다 (ID: ${eid}). 삭제 후 다시 생성하거나 다른 이름을 사용하세요.` });
              }
            }
          }
        }
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

      case "setup_random_team_league": {
        // 코드 레벨 가드: 사전 구성 팀 정보가 넘어오면 잘못된 도구 선택 → 에러로 리다이렉트
        if (input.teams && Array.isArray(input.teams) && (input.teams as unknown[]).length > 0) {
          return JSON.stringify({ error: "팀별 선수가 이미 지정되어 있습니다. setup_random_team_league가 아닌 setup_full_tournament(type='team', teams=[...]) 도구를 사용하세요." });
        }
        const rtPlayersRaw = input.players as Array<{ name: string; gender?: string; team?: string }> | undefined;
        if (rtPlayersRaw?.some(p => p.team)) {
          return JSON.stringify({ error: "선수에 팀 소속(team)이 지정되어 있습니다. 사전 구성 팀전은 setup_full_tournament(type='team', teams=[{name:'팀명', memberNames:['선수1','선수2']}]) 도구를 사용하세요." });
        }
        const now = Date.now();
        const rtPlayers = input.players as Array<{ name: string; gender?: string }>;
        const rtTeamSize = (input.teamSize as number) || 3;
        const rtSeeds = (input.seeds as string[]) || [];
        const rtCustomNames = (input.teamNames as string[]) || [];
        const rtWinScore = (input.winScore as number) || 31;
        const rtGroupCount = (input.groupCount as number) || 1;

        if (!rtPlayers || rtPlayers.length < rtTeamSize * 2) return JSON.stringify({ error: `최소 ${rtTeamSize * 2}명의 선수가 필요합니다.` });

        // 동일 이름 대회 중복 방지
        const rtExisting = await db.ref("tournaments").once("value");
        if (rtExisting.exists()) {
          for (const [eid, ev] of Object.entries(rtExisting.val() as Record<string, { name?: string }>)) {
            if (ev.name === input.name) {
              return JSON.stringify({ error: `"${input.name}" 대회가 이미 존재합니다 (ID: ${eid}).` });
            }
          }
        }

        // 중복 검사
        const rtNameSet = new Set<string>();
        for (const p of rtPlayers) {
          if (rtNameSet.has(p.name)) return JSON.stringify({ error: `중복 선수명: ${p.name}` });
          rtNameSet.add(p.name);
        }
        const rtInvalidSeeds = rtSeeds.filter(s => !rtNameSet.has(s));
        if (rtInvalidSeeds.length > 0) return JSON.stringify({ error: `시드 선수를 찾을 수 없습니다: ${rtInvalidSeeds.join(", ")}` });

        const teamCount = Math.floor(rtPlayers.length / rtTeamSize);
        if (teamCount < 2) return JSON.stringify({ error: `최소 2팀 필요 (${rtPlayers.length}명 / ${rtTeamSize}인 = ${teamCount}팀)` });
        if (rtGroupCount > teamCount) return JSON.stringify({ error: `조 수(${rtGroupCount})가 팀 수(${teamCount})를 초과` });

        // 1. 대회 생성
        const rtRef = db.ref("tournaments").push();
        const rtTid = rtRef.key!;
        const rtDate = (input.date as string) || new Date().toISOString().split("T")[0];
        const rtQualStageId = `stage_qualifying_${rtTid}`;

        await rtRef.set({
          name: input.name || "랜덤 팀 리그",
          date: rtDate,
          ...(input.endDate ? { endDate: input.endDate } : {}),
          type: "randomTeamLeague",
          format: rtGroupCount > 1 ? "group_league" : "full_league",
          formatType: rtGroupCount > 1 ? "group_knockout" : "round_robin",
          status: "draft",
          gameConfig: { winScore: rtWinScore, setsToWin: 1 },
          teamMatchSettings: { winScore: rtWinScore, setsToWin: 1, minLead: 2 },
          teamRules: { teamSize: rtTeamSize, rotationEnabled: false },
          qualifyingConfig: rtGroupCount > 1 ? { format: "group_round_robin", groupCount: rtGroupCount } : undefined,
          createdAt: now, updatedAt: now,
        });

        // 2. 선수 등록
        const rtBulk: Record<string, unknown> = {};
        const rtPlayerMap = new Map<string, string>();
        for (const p of rtPlayers) {
          const key = db.ref(`tournamentPlayers/${rtTid}`).push().key!;
          rtBulk[`tournamentPlayers/${rtTid}/${key}`] = { name: p.name, gender: p.gender || "", club: "", class: "", createdAt: now };
          rtPlayerMap.set(p.name, key);
        }

        // 3. 팀 구성 (탑시드 분산 + 성별 균등 배분)
        const males = rtPlayers.filter(p => p.gender === "male" || p.gender === "남");
        const females = rtPlayers.filter(p => p.gender === "female" || p.gender === "여");
        const rtTeams: Array<{ id: string; name: string; memberIds: string[]; memberNames: string[] }> = [];
        for (let i = 0; i < teamCount; i++) {
          const tName = rtCustomNames[i] || `${i + 1}팀`;
          rtTeams.push({ id: `team_${i + 1}`, name: tName, memberIds: [], memberNames: [] });
        }

        // 3a. 시드 배치: 각 팀에 1명씩
        const rtSeedSet = new Set<string>();
        for (let i = 0; i < Math.min(rtSeeds.length, teamCount); i++) {
          const sid = rtPlayerMap.get(rtSeeds[i]);
          if (sid) {
            rtTeams[i].memberIds.push(sid);
            rtTeams[i].memberNames.push(rtSeeds[i]);
            rtSeedSet.add(rtSeeds[i]);
          }
        }

        // 3b. 성별 균등 배분: 여자 먼저 배분 → 남자 채우기
        const remainFemales = females.filter(p => !rtSeedSet.has(p.name)).sort(() => Math.random() - 0.5);
        const remainMales = males.filter(p => !rtSeedSet.has(p.name)).sort(() => Math.random() - 0.5);
        const remainOthers = rtPlayers.filter(p => !rtSeedSet.has(p.name) && p.gender !== "male" && p.gender !== "남" && p.gender !== "female" && p.gender !== "여").sort(() => Math.random() - 0.5);

        // 여자 1명씩 각 팀에 배정
        for (const f of remainFemales) {
          const team = rtTeams.find(t => t.memberIds.length < rtTeamSize && !t.memberNames.some(n => {
            const pl = rtPlayers.find(p => p.name === n);
            return pl && (pl.gender === "female" || pl.gender === "여");
          }));
          if (team) {
            const fid = rtPlayerMap.get(f.name)!;
            team.memberIds.push(fid);
            team.memberNames.push(f.name);
          }
        }

        // 남자로 나머지 채우기
        for (const m of [...remainMales, ...remainOthers]) {
          const team = rtTeams.reduce((a, b) => a.memberIds.length <= b.memberIds.length ? a : b);
          if (team.memberIds.length >= rtTeamSize) break;
          const mid = rtPlayerMap.get(m.name)!;
          if (mid && !rtTeams.some(t => t.memberIds.includes(mid))) {
            team.memberIds.push(mid);
            team.memberNames.push(m.name);
          }
        }

        // 팀 저장
        for (const team of rtTeams) {
          rtBulk[`teams/${rtTid}/${team.id}`] = { name: team.name, memberIds: team.memberIds, memberNames: team.memberNames, createdAt: now };
        }

        // 4. 조 편성 (groupCount > 1이면 조별)
        const rtGroups: Array<{ id: string; name: string; teamIds: string[] }> = [];
        if (rtGroupCount > 1) {
          for (let i = 0; i < rtGroupCount; i++) {
            rtGroups.push({ id: `group_${String.fromCharCode(65 + i)}`, name: `${String.fromCharCode(65 + i)}조`, teamIds: [] });
          }
          // 스네이크 드래프트로 팀을 조에 배분
          for (let i = 0; i < rtTeams.length; i++) {
            const round = Math.floor(i / rtGroupCount);
            const pos = i % rtGroupCount;
            const gi = round % 2 === 0 ? pos : rtGroupCount - 1 - pos;
            rtGroups[gi].teamIds.push(rtTeams[i].id);
          }
          // 스테이지 저장
          rtBulk[`tournaments/${rtTid}/stages`] = [{
            id: rtQualStageId, type: "qualifying", format: "group_round_robin", status: "pending",
            groupCount: rtGroupCount,
            groups: rtGroups.map(g => ({ id: g.id, stageId: rtQualStageId, name: g.name, playerIds: [], teamIds: g.teamIds })),
          }];
        }

        // 5. 경기 생성 (조별이면 조 안에서만, 아니면 전체)
        let rtMatchCount = 0;
        const matchGroups = rtGroupCount > 1 ? rtGroups : [{ id: "", name: "전체", teamIds: rtTeams.map(t => t.id) }];

        for (const grp of matchGroups) {
          const gTeams = grp.teamIds;
          for (let i = 0; i < gTeams.length; i++) {
            for (let j = i + 1; j < gTeams.length; j++) {
              const t1 = rtTeams.find(t => t.id === gTeams[i])!;
              const t2 = rtTeams.find(t => t.id === gTeams[j])!;
              const mKey = db.ref(`matches/${rtTid}`).push().key!;
              rtBulk[`matches/${rtTid}/${mKey}`] = {
                tournamentId: rtTid, type: "team", status: "pending",
                round: rtMatchCount + 1,
                team1Id: t1.id, team2Id: t2.id,
                team1Name: t1.name, team2Name: t2.name,
                team1: { memberIds: t1.memberIds, memberNames: t1.memberNames },
                team2: { memberIds: t2.memberIds, memberNames: t2.memberNames },
                sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
                currentSet: 0, player1Timeouts: 0, player2Timeouts: 0,
                winnerId: null, createdAt: now + rtMatchCount,
                ...(grp.id ? { groupId: grp.id, stageId: rtQualStageId } : {}),
              };
              rtMatchCount++;
            }
          }
        }

        await db.ref().update(rtBulk);

        const rtTeamSummary = rtTeams.map(t => `${t.name}: ${t.memberNames.join(", ")}`).join("\n");
        const rtGroupSummary = rtGroupCount > 1
          ? "\n\n조 편성:\n" + rtGroups.map(g => `${g.name}: ${g.teamIds.map(tid => rtTeams.find(t => t.id === tid)?.name || tid).join(", ")}`).join("\n")
          : "";

        return JSON.stringify({
          success: true,
          tournamentId: rtTid,
          playerCount: rtPlayers.length,
          teamCount, teamSize: rtTeamSize,
          groupCount: rtGroupCount,
          matchCount: rtMatchCount,
          seeds: rtSeeds,
          teamAssignment: rtTeamSummary,
          groupAssignment: rtGroupSummary,
          message: `랜덤 팀 리그 "${input.name}" 생성 완료\n${rtPlayers.length}명 → ${teamCount}팀 (${rtTeamSize}인)${rtGroupCount > 1 ? `, ${rtGroupCount}개 조` : ""}\n시드 ${rtSeeds.length}명 분산, 성별 균등 배분\n${rtMatchCount}경기 ${rtGroupCount > 1 ? "조별 " : ""}라운드로빈\n\n${rtTeamSummary}${rtGroupSummary}`,
        });
      }

      case "setup_full_tournament": {
        const now = Date.now();
        const tourType = (input.type as string) || "individual";
        const isTeamTour = tourType === "team" || tourType === "randomTeamLeague";
        const players = (input.players as Array<{ name: string; club?: string; class?: string; gender?: string }>) || [];
        const inputTeams = (input.teams as Array<{ name: string; memberNames?: string[]; coachName?: string }>) || [];

        // 코드 가드: type=team인데 teams가 비어있으면 에러
        if (isTeamTour && inputTeams.length === 0) {
          return JSON.stringify({ error: "type=team이지만 teams 파라미터가 비어있습니다. 사용자가 지정한 팀 구성을 teams: [{name:'팀명', memberNames:['선수1','선수2'], coachName:'코치명'}] 형태로 전달하세요. players가 아닌 teams를 사용해야 합니다." });
        }
        const groupCount = (input.groupCount as number) || 4;
        const advancePerGroup = (input.advancePerGroup as number) || 2;
        const seeds = (input.seeds as string[]) || [];
        const qualWinScore = (input.qualifyingWinScore as number) || (isTeamTour ? 31 : 11);
        const qualSetsToWin = (input.qualifyingSetsToWin as number) || (isTeamTour ? 1 : 2);
        const finalsFormat = (input.finalsFormat as string) || "single_elimination";
        const thirdPlace = input.thirdPlace !== false;
        const fifthToEighth = (input.fifthToEighth as boolean) || false;
        const classificationGroups = (input.classificationGroups as boolean) || false;
        const wildcardCountInput = (input.wildcardCount as number) || 0;
        const rankingUpToInput = (input.rankingUpTo as number) || 0;
        // 새 파라미터들
        const scheduleDatesInput = (input.scheduleDates as string[]) || [];
        const teamSize = (input.teamSize as number) || 3;
        const maxReserves = (input.maxReserves as number) || 1;
        const genderRatio = (input.genderRatio as { male: number; female: number }) || { male: 2, female: 1 };
        const rotationEnabled = (input.rotationEnabled as boolean) || false;
        const rotationInterval = (input.rotationInterval as number) || 6;
        const finalsStartRound = input.finalsStartRound as number | undefined;
        const avoidSameGroup = input.avoidSameGroup !== false;
        const bracketArrangement = (input.bracketArrangement as string) || "cross_group";
        const fifthToEighthFormat = (input.fifthToEighthFormat as string) || "simple";
        const classificationGroupSize = (input.classificationGroupSize as number) || 4;
        const minLead = (input.minLead as number) || 2;
        const deuceEnabled = input.deuceEnabled !== false;
        const tiebreakerRules = (input.tiebreakerRules as string[]) || [];
        const finalsSetsToWin = input.finalsSetsToWin as number | undefined;
        const finalsWinScore = input.finalsWinScore as number | undefined;
        const roundOverrideFromRound = input.roundOverrideFromRound as number | undefined;
        const roundOverrideSetsToWin = input.roundOverrideSetsToWin as number | undefined;
        // 참가 단위 수 (개인전: 선수 수, 팀전: 팀 수)
        const participants = isTeamTour ? inputTeams : players;
        const participantCount = participants.length;
        const totalAdvance = groupCount * advancePerGroup;

        // 입력 검증
        if (participantCount < 2) return JSON.stringify({ error: isTeamTour ? "최소 2팀이 필요합니다." : "최소 2명의 선수가 필요합니다." });
        if (groupCount > participantCount) return JSON.stringify({ error: `조 수(${groupCount})가 ${isTeamTour ? "팀" : "선수"} 수(${participantCount})를 초과할 수 없습니다.` });

        // 동일 이름 대회 중복 방지
        const ftExisting = await db.ref("tournaments").once("value");
        if (ftExisting.exists()) {
          for (const [eid, ev] of Object.entries(ftExisting.val() as Record<string, { name?: string }>)) {
            if (ev.name === input.name) {
              return JSON.stringify({ error: `"${input.name}" 대회가 이미 존재합니다 (ID: ${eid}). 삭제 후 다시 생성하거나 다른 이름을 사용하세요.` });
            }
          }
        }

        // 중복 이름 검사
        const nameSet = new Set<string>();
        for (const p of participants) {
          if (nameSet.has(p.name)) return JSON.stringify({ error: `중복 이름: ${p.name}` });
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

        const isFullLeague = groupCount <= 1;
        const effectiveFinalsStartRound = finalsStartRound || totalAdvance;
        const effectiveFinalsSetsToWin = finalsSetsToWin || qualSetsToWin;
        const effectiveFinalsWinScore = finalsWinScore || qualWinScore;
        const tournamentData: Record<string, unknown> = {
          name: input.name || "새 대회",
          date: input.date || new Date().toISOString().split("T")[0],
          ...(input.endDate ? { endDate: input.endDate } : {}),
          ...(scheduleDatesInput.length > 0 ? { scheduleDates: scheduleDatesInput } : {}),
          ...(input.groupId ? { groupId: input.groupId, groupName: input.groupName || "" } : {}),
          type: tourType,
          format: isFullLeague ? "full_league" : "group_league",
          formatType: isFullLeague ? "round_robin" : "group_knockout",
          status: "draft",
          gameConfig: { winScore: qualWinScore, setsToWin: qualSetsToWin },
          scoringRules: { winScore: qualWinScore, setsToWin: qualSetsToWin, maxSets: qualSetsToWin * 2 - 1, minLead, deuceEnabled },
          matchRules: { timeoutsPerPlayer: 1, timeoutDurationSeconds: 60 },
          ...(isTeamTour ? {
            teamMatchSettings: { winScore: qualWinScore, setsToWin: qualSetsToWin, minLead },
            teamRules: { teamSize, maxReserves, rotationEnabled, rotationInterval, genderRatio },
          } : {}),
          ...(tiebreakerRules.length > 0 ? { tiebreakerRules } : {}),
          qualifyingConfig: isFullLeague
            ? { format: "round_robin", scoringRules: { winScore: qualWinScore, setsToWin: qualSetsToWin, maxSets: qualSetsToWin * 2 - 1, minLead, deuceEnabled } }
            : { format: "group_round_robin", groupCount, scoringRules: { winScore: qualWinScore, setsToWin: qualSetsToWin, maxSets: qualSetsToWin * 2 - 1, minLead, deuceEnabled } },
          ...(isFullLeague ? {} : {
            finalsConfig: {
              format: finalsFormat,
              advanceCount: totalAdvance,
              startingRound: effectiveFinalsStartRound,
              seedMethod: bracketArrangement === "custom" ? "custom" : "ranking",
              advancePerGroup,
              ...(wildcardCountInput > 0 ? { wildcardCount: wildcardCountInput } : {}),
              avoidSameGroup,
              bracketArrangement,
              scoringRules: { winScore: effectiveFinalsWinScore, setsToWin: effectiveFinalsSetsToWin, maxSets: effectiveFinalsSetsToWin * 2 - 1, minLead, deuceEnabled },
              ...(roundOverrideFromRound && roundOverrideSetsToWin ? {
                roundScoringOverride: {
                  fromRound: roundOverrideFromRound,
                  scoringRules: { winScore: effectiveFinalsWinScore, setsToWin: roundOverrideSetsToWin, maxSets: roundOverrideSetsToWin * 2 - 1, minLead, deuceEnabled },
                },
              } : {}),
            },
            rankingMatchConfig: {
              enabled: thirdPlace || fifthToEighth || classificationGroups || rankingUpToInput > 0,
              thirdPlace,
              fifthToEighth,
              fifthToEighthFormat,
              classificationGroups,
              classificationGroupSize,
              ...(rankingUpToInput > 0 ? { rankingUpTo: rankingUpToInput } : {}),
            },
          }),
          stages: isFullLeague
            ? [{ id: qualStageId, type: "qualifying", format: "round_robin", status: "pending", groupCount: 1, groups: [] }]
            : [
                { id: qualStageId, type: "qualifying", format: "group_round_robin", status: "pending", groupCount, groups: [] },
                { id: finalsStageId, type: "finals", format: finalsFormat, status: "pending", advanceCount: totalAdvance },
              ],
          createdAt: now,
          updatedAt: now,
        };
        await tourRef.set(tournamentData);

        // 2~4 전부 한 번의 multi-path update로 처리
        const bulkUpdate: Record<string, unknown> = {};
        const idMap = new Map<string, string>(); // name → id
        const nameMap = new Map<string, string>(); // id → name

        if (isTeamTour) {
          // 팀전: 팀 등록 + 팀원을 선수로도 등록
          for (const team of inputTeams) {
            const teamId = db.ref(`teams/${tid}`).push().key!;
            const memberIds: string[] = [];
            for (const mName of (team.memberNames || [])) {
              const pKey = db.ref(`tournamentPlayers/${tid}`).push().key!;
              bulkUpdate[`tournamentPlayers/${tid}/${pKey}`] = { name: mName, club: "", class: "", gender: "", createdAt: now };
              memberIds.push(pKey);
            }
            bulkUpdate[`teams/${tid}/${teamId}`] = {
              name: team.name, memberIds, memberNames: team.memberNames || [], createdAt: now,
              ...(team.coachName ? { coachName: team.coachName } : {}),
            };
            idMap.set(team.name, teamId);
            nameMap.set(teamId, team.name);
          }
        } else {
          // 개인전: 선수 등록
          for (const p of players) {
            const pKey = db.ref(`tournamentPlayers/${tid}`).push().key!;
            bulkUpdate[`tournamentPlayers/${tid}/${pKey}`] = { name: p.name, club: (p as Record<string, unknown>).club || "", class: (p as Record<string, unknown>).class || "", gender: (p as Record<string, unknown>).gender || "", createdAt: now };
            idMap.set(p.name, pKey);
            nameMap.set(pKey, p.name);
          }
        }

        // 3. 조 편성
        const groups: Array<{ id: string; stageId: string; name: string; playerIds: string[]; teamIds: string[] }> = [];
        const allIds = participants.map(p => idMap.get(p.name)!).filter(Boolean);

        if (isFullLeague) {
          // 풀리그: 조 없이 전체 참가자를 하나의 그룹으로
          const fullGroup = { id: "full_league", stageId: qualStageId, name: "전체 리그", playerIds: [] as string[], teamIds: [] as string[] };
          if (isTeamTour) fullGroup.teamIds = allIds;
          else fullGroup.playerIds = allIds;
          groups.push(fullGroup);
        } else {
          // 조별 리그: 스네이크 드래프트 + 시드
          for (let i = 0; i < groupCount; i++) {
            groups.push({ id: `group_${String.fromCharCode(65 + i)}`, stageId: qualStageId, name: `${String.fromCharCode(65 + i)}조`, playerIds: [], teamIds: [] });
          }
          const seedSet = new Set<string>();
          for (let i = 0; i < Math.min(seeds.length, groupCount); i++) {
            const seedId = idMap.get(seeds[i]);
            if (seedId) {
              if (isTeamTour) groups[i].teamIds.push(seedId);
              else groups[i].playerIds.push(seedId);
              seedSet.add(seedId);
            }
          }
          const remainingIds = allIds.filter(id => !seedSet.has(id));
          for (let i = 0; i < remainingIds.length; i++) {
            const round = Math.floor(i / groupCount);
            const pos = i % groupCount;
            const groupIndex = round % 2 === 0 ? pos : groupCount - 1 - pos;
            if (isTeamTour) groups[groupIndex].teamIds.push(remainingIds[i]);
            else groups[groupIndex].playerIds.push(remainingIds[i]);
          }
        }

        const tdStages = tournamentData.stages as Array<Record<string, unknown>>;
        bulkUpdate[`tournaments/${tid}/stages`] = isFullLeague
          ? [{ ...tdStages[0], groups }]
          : [{ ...tdStages[0], groups }, tdStages[1]];
        bulkUpdate[`tournaments/${tid}/seeds`] = seeds.map((name, i) => ({
          position: i + 1, playerId: idMap.get(name) || "", name,
        }));

        // 4. 예선 라운드로빈 경기 생성
        let matchCount = 0;
        for (const group of groups) {
          const ids = isTeamTour ? group.teamIds : group.playerIds;
          for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
              const mKey = db.ref(`matches/${tid}`).push().key!;
              if (isTeamTour) {
                // 팀전 경기
                const t1Data = (bulkUpdate[`teams/${tid}/${ids[i]}`] || {}) as Record<string, unknown>;
                const t2Data = (bulkUpdate[`teams/${tid}/${ids[j]}`] || {}) as Record<string, unknown>;
                bulkUpdate[`matches/${tid}/${mKey}`] = {
                  tournamentId: tid, type: "team", status: "pending",
                  round: matchCount + 1,
                  team1Id: ids[i], team2Id: ids[j],
                  team1Name: nameMap.get(ids[i]) || ids[i],
                  team2Name: nameMap.get(ids[j]) || ids[j],
                  team1: { memberIds: t1Data.memberIds || [], memberNames: t1Data.memberNames || [], coachName: t1Data.coachName || "" },
                  team2: { memberIds: t2Data.memberIds || [], memberNames: t2Data.memberNames || [], coachName: t2Data.coachName || "" },
                  player1Coach: t1Data.coachName || "",
                  player2Coach: t2Data.coachName || "",
                  sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
                  currentSet: 0, player1Timeouts: 0, player2Timeouts: 0, winnerId: null,
                  createdAt: now + matchCount, groupId: group.id, stageId: qualStageId,
                };
              } else {
                // 개인전 경기
                bulkUpdate[`matches/${tid}/${mKey}`] = {
                  tournamentId: tid, type: "individual", status: "pending",
                  round: matchCount + 1, player1Id: ids[i], player2Id: ids[j],
                  player1Name: nameMap.get(ids[i]) || ids[i], player2Name: nameMap.get(ids[j]) || ids[j],
                  sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
                  currentSet: 0, player1Timeouts: 0, player2Timeouts: 0, winnerId: null,
                  createdAt: now + matchCount, groupId: group.id, stageId: qualStageId,
                };
              }
              matchCount++;
            }
          }
        }

        await db.ref().update(bulkUpdate);

        const groupSummary = groups.map(g => {
          const ids = isTeamTour ? g.teamIds : g.playerIds;
          return `${g.name}: ${ids.map(id => nameMap.get(id) || id).join(", ")}`;
        }).join("\n");

        return JSON.stringify({
          success: true,
          tournamentId: tid,
          participantCount,
          type: isTeamTour ? "team" : "individual",
          groupCount,
          matchCount,
          advancePerGroup,
          totalAdvance,
          thirdPlace,
          fifthToEighth,
          classificationGroups,
          groupAssignment: groupSummary,
          message: isFullLeague
            ? `${isTeamTour ? "팀전" : "개인전"} "${input.name}" 생성 완료\n${isTeamTour ? "팀" : "선수"} ${participantCount}${isTeamTour ? "팀" : "명"}, 풀리그 ${matchCount}경기`
            : `${isTeamTour ? "팀전" : "개인전"} "${input.name}" 생성 완료\n${isTeamTour ? "팀" : "선수"} ${participantCount}${isTeamTour ? "팀" : "명"}, ${groupCount}개 조, 예선 ${matchCount}경기\n조당 ${advancePerGroup}${isTeamTour ? "팀" : "명"} 본선 진출 (총 ${totalAdvance})\n3/4위=${thirdPlace}, 5-8위=${fifthToEighth}, 하위순위=${classificationGroups}`,
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
          type: input.matchType || "individual",
          status: "pending",
          round: input.round || 1,
          player1Id: input.player1Id || input.team1Id || "",
          player2Id: input.player2Id || input.team2Id || "",
          player1Name: input.player1Name || input.team1Name || "",
          player2Name: input.player2Name || input.team2Name || "",
          ...((input.matchType === "team" || input.team1Id) ? {
            team1Id: input.team1Id || input.player1Id, team2Id: input.team2Id || input.player2Id,
            team1Name: input.team1Name || input.player1Name, team2Name: input.team2Name || input.player2Name,
          } : {}),
          sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
          currentSet: 0,
          player1Timeouts: 0,
          player2Timeouts: 0,
          winnerId: null,
          createdAt: now,
          ...(input.groupId ? { groupId: input.groupId } : {}),
          ...(input.stageId ? { stageId: input.stageId } : {}),
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

        // 중복 생성 방지: 이미 해당 그룹에 경기가 존재하면 에러
        const existingMatchSnap = await db.ref(`matches/${tid}`).once("value");
        if (existingMatchSnap.exists()) {
          const existingMatches = Object.values(existingMatchSnap.val() as Record<string, Record<string, unknown>>);
          const groupId = input.groupId as string | undefined;
          const groupMatches = groupId
            ? existingMatches.filter(m => m.groupId === groupId)
            : existingMatches;
          if (groupMatches.length > 0) {
            return JSON.stringify({ error: `이미 ${groupMatches.length}경기가 존재합니다. 중복 생성 방지. 기존 경기를 삭제 후 재생성하거나 다른 groupId를 지정하세요.` });
          }
        }

        // 대회 타입 자동 감지
        const rrTourSnap = await db.ref(`tournaments/${tid}/type`).once("value");
        const isTeamTour = rrTourSnap.val() === "team";

        const now = Date.now();
        const matches: Record<string, unknown>[] = [];

        if (isTeamTour) {
          // === 팀전: 팀 ID 기반 매치 생성 ===
          let teamIds = input.teamIds as string[] | undefined;
          if (!teamIds || teamIds.length === 0) {
            const teamSnap = await db.ref(`teams/${tid}`).once("value");
            if (!teamSnap.exists()) return JSON.stringify({ error: "팀이 없습니다." });
            teamIds = Object.keys(teamSnap.val());
          }

          // 팀 이름/멤버 조회
          const teamSnap = await db.ref(`teams/${tid}`).once("value");
          const teamData = teamSnap.exists() ? teamSnap.val() as Record<string, { name: string; memberIds?: string[]; memberNames?: string[]; coachName?: string }> : {};

          for (let i = 0; i < teamIds.length; i++) {
            for (let j = i + 1; j < teamIds.length; j++) {
              const t1 = teamData[teamIds[i]] || { name: teamIds[i] };
              const t2 = teamData[teamIds[j]] || { name: teamIds[j] };
              matches.push({
                tournamentId: tid,
                type: "team",
                status: "pending",
                round: matches.length + 1,
                team1Id: teamIds[i],
                team2Id: teamIds[j],
                team1Name: t1.name,
                team2Name: t2.name,
                team1: { memberIds: t1.memberIds || [], memberNames: t1.memberNames || [], coachName: t1.coachName || "" },
                team2: { memberIds: t2.memberIds || [], memberNames: t2.memberNames || [], coachName: t2.coachName || "" },
                player1Coach: t1.coachName || "",
                player2Coach: t2.coachName || "",
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
        } else {
          // === 개인전: 선수 ID 기반 매치 생성 ===
          let playerIds = input.playerIds as string[] | undefined;
          if (!playerIds || playerIds.length === 0) {
            const snap = await db.ref(`tournamentPlayers/${tid}`).once("value");
            if (!snap.exists()) return JSON.stringify({ error: "선수가 없습니다." });
            playerIds = Object.keys(snap.val());
          }

          const playerSnap = await db.ref(`tournamentPlayers/${tid}`).once("value");
          const playerData = playerSnap.exists() ? playerSnap.val() : {};
          const nameMap = new Map<string, string>();
          for (const [id, v] of Object.entries(playerData)) {
            nameMap.set(id, (v as { name: string }).name);
          }

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
        }

        const bulk: Record<string, unknown> = {};
        for (const m of matches) {
          const key = db.ref(`matches/${tid}`).push().key!;
          bulk[`matches/${tid}/${key}`] = m;
        }
        await db.ref().update(bulk);

        return JSON.stringify({ success: true, count: matches.length, type: isTeamTour ? "team" : "individual", message: `${matches.length}경기 ${isTeamTour ? "팀" : "개인"}전 라운드로빈 생성 완료` });
      }

      // --- Write: Schedule (고급) ---
      case "simulate_matches": {
        const tid = input.tournamentId as string;
        const now = Date.now();
        const stageId = input.stageId as string | undefined;
        const groupId = input.groupId as string | undefined;

        // 대회 설정에서 세트 수/점수 자동 로드
        const tourSnap = await db.ref(`tournaments/${tid}`).once("value");
        const tourData = tourSnap.exists() ? tourSnap.val() as Record<string, unknown> : {};
        const isTeamType = tourData.type === "team" || tourData.type === "randomTeamLeague";
        const teamSettings = tourData.teamMatchSettings as { winScore?: number; setsToWin?: number } | undefined;
        const gameConfig = tourData.gameConfig as { winScore?: number; setsToWin?: number } | undefined;
        // 팀전: teamMatchSettings 우선, 개인전: gameConfig 우선
        const winScore = Math.max(4, (input.winScore as number) || (isTeamType ? teamSettings?.winScore : gameConfig?.winScore) || (isTeamType ? 31 : 11));
        const setsToWin = Math.max(1, (input.setsToWin as number) || (isTeamType ? teamSettings?.setsToWin : gameConfig?.setsToWin) || (isTeamType ? 1 : 2));

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

          // 서브 기준 점수 표시 (coinToss 후 계산되므로 여기서는 player1 기준, coinToss 후 재계산)
          const scoreStr = sets.map(s => `${s.player1Score}-${s.player2Score}`).join(", ");
          results.push({ match: `${match.player1Name || match.team1Name} vs ${match.player2Name || match.team2Name}`, score: scoreStr, winner: winnerName });

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

          for (let si = 0; si < sets.length; si++) {
            const s = sets[si];
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

            // 개인전 사이드체인지: 결정세트(마지막 세트)에서만 6점에서 수행
            const isDecidingSet = !isTeamMatch && si === sets.length - 1;
            const doSideChange = isTeamMatch || isDecidingSet;

            while (sc1 < s.player1Score || sc2 < s.player2Score) {
              t += 10000 + Math.floor(Math.random() * 20000);
              const maxSc = Math.max(sc1, sc2);

              // 사이드 체인지: 팀전=매 세트 16점, 개인전=결정세트만 6점
              if (doSideChange && !sideChanged && maxSc >= sideChangePoint) {
                sideChanged = true;
                t += 60000;
                history.push({ time: fmt(t), set: si + 1, scoringPlayer: "", actionPlayer: "", actionType: "side_change", actionLabel: `사이드 체인지 (${sideChangePoint}점)`, points: 0, server: "", serveNumber: 0, scoreBefore: { player1: sc1, player2: sc2 }, scoreAfter: { player1: sc1, player2: sc2 }, serverSide: currentServer });
              }

              // 타임아웃
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
              const p1Turn = sc1 < s.player1Score && (sc2 >= s.player2Score || Math.random() > 0.5);
              const isGoal = Math.random() < 0.7;
              if (isGoal) {
                // 골: +2 득점자에게
                if (p1Turn) { sc1 = Math.min(sc1 + 2, s.player1Score); } else { sc2 = Math.min(sc2 + 2, s.player2Score); }
              } else {
                // 파울: +1 상대에게 (p1Turn이면 p2가 파울 → p1에게 +1)
                if (p1Turn) { sc1 = Math.min(sc1 + 1, s.player1Score); } else { sc2 = Math.min(sc2 + 1, s.player2Score); }
              }
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
                // (서브 선택 팀: 서브 3번 → 교체, 리시브 선택 팀: 리시브 3번 + 서브 3번 → 교체)
                if (isTeamMatch) {
                  const servingTeam = currentServer; // 방금 서브한 팀
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
          }

          bulk[`matches/${tid}/${mid}/sets`] = sets;
          bulk[`matches/${tid}/${mid}/currentSet`] = sets.length - 1;
          bulk[`matches/${tid}/${mid}/status`] = "completed";
          bulk[`matches/${tid}/${mid}/winnerId`] = winnerId;
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
        // 주의: bulk update 직후이므로 Firebase에서 다시 읽어야 최신 상태 반영
        await new Promise(r => setTimeout(r, 500)); // Firebase 반영 대기
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
          const tourFormat = tourData.format as string || "";
          const isFullLeagueFormat = tourFormat === "full_league" || tourData.formatType === "round_robin";
          if (!isFullLeagueFormat) {
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
                  const genResult = await executeTool("generate_finals", { tournamentId: tid });
                  const genParsed = JSON.parse(genResult);
                  if (genParsed.success) {
                    results.push({ match: "결승 자동 생성", score: "", winner: `${genParsed.matchCount}경기 생성` });
                    // 결승 경기 시뮬레이션
                    const simResult = await executeTool("simulate_matches", { tournamentId: tid });
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

      case "generate_finals": {
        const tid = input.tournamentId as string;
        const tourSnap2 = await db.ref(`tournaments/${tid}`).once("value");
        if (!tourSnap2.exists()) return JSON.stringify({ error: "대회를 찾을 수 없습니다." });
        const tour2 = tourSnap2.val() as Record<string, unknown>;

        const finalsConfig2 = tour2.finalsConfig as Record<string, unknown> | undefined;
        const rankingConfig2 = tour2.rankingMatchConfig as Record<string, unknown> | undefined;
        const stages2 = (tour2.stages || []) as Array<Record<string, unknown>>;
        const qualStage2 = stages2.find(s => s.type === "qualifying");
        let finalsStageId2 = stages2.find(s => s.type === "finals")?.id as string | undefined;
        if (!finalsStageId2) {
          // finals 스테이지가 없으면 자동 생성
          finalsStageId2 = `stage_finals_${tid}`;
          const newStages = [...stages2, { id: finalsStageId2, type: "finals", format: "single_elimination", status: "pending" }];
          await db.ref(`tournaments/${tid}/stages`).set(newStages);
        }
        const advancePerGroup2 = (input.advancePerGroup as number) || (finalsConfig2?.advancePerGroup as number) || 2;
        const includeThirdPlace2 = input.includeThirdPlace !== false && (rankingConfig2?.thirdPlace !== false);
        const includeFifthToEighth2 = (input.includeFifthToEighth as boolean) || (rankingConfig2?.fifthToEighth as boolean) || false;
        const includeClassification2 = (input.includeClassification as boolean) || (rankingConfig2?.classificationGroups as boolean) || false;
        const rankingUpTo = (input.rankingUpTo as number) || (rankingConfig2?.rankingUpTo as number) || 0;

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

        const wildcardCount = (input.wildcardCount as number) || (finalsConfig2?.wildcardCount as number) || 0;

        const advanced: Array<{ id: string; name: string; gid: string; rank: number }> = [];
        const eliminated: Array<{ id: string; name: string; gid: string; rank: number }> = [];
        const wildcardCandidates: Array<{ id: string; name: string; gid: string; rank: number; wins: number; sd: number; pd: number }> = [];
        const gids = [...gStats.keys()].sort();
        for (const gid of gids) {
          const sorted = [...gStats.get(gid)!.values()].sort((a, b) => b.wins - a.wins || b.sd - a.sd || b.pd - a.pd || a.name.localeCompare(b.name));
          sorted.forEach((p, i) => {
            if (i < advancePerGroup2) {
              advanced.push({ id: p.id, name: p.name, gid, rank: i + 1 });
            } else if (wildcardCount > 0 && i === advancePerGroup2) {
              // 와일드카드 후보: 각 조의 advancePerGroup+1 위 (예: 3위)
              wildcardCandidates.push({ id: p.id, name: p.name, gid, rank: i + 1, wins: p.wins, sd: p.sd, pd: p.pd });
            } else {
              eliminated.push({ id: p.id, name: p.name, gid, rank: i + 1 });
            }
          });
        }

        // 와일드카드: 전체 조의 차순위 중 성적 상위 M명 추가 진출
        if (wildcardCount > 0 && wildcardCandidates.length > 0) {
          wildcardCandidates.sort((a, b) => b.wins - a.wins || b.sd - a.sd || b.pd - a.pd);
          const wcAdvanced = wildcardCandidates.slice(0, wildcardCount);
          const wcEliminated = wildcardCandidates.slice(wildcardCount);
          for (const wc of wcAdvanced) advanced.push({ id: wc.id, name: wc.name, gid: wc.gid, rank: wc.rank });
          for (const wc of wcEliminated) eliminated.push({ id: wc.id, name: wc.name, gid: wc.gid, rank: wc.rank });
        } else {
          // 와일드카드 없으면 후보를 전부 탈락으로
          for (const wc of wildcardCandidates) eliminated.push({ id: wc.id, name: wc.name, gid: wc.gid, rank: wc.rank });
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
            round: 1, bracketPosition: i, bracketRound: getRoundName(r1.length * 2), roundLabel: getRoundName(r1.length * 2),
            stageId: finalsStageId2,
            player1Id: p1.id, player2Id: p2.id,
            player1Name: p1.name, player2Name: p2.name,
            ...(tour2.type === "team" || tour2.type === "randomTeamLeague" ? { team1Id: p1.id, team2Id: p2.id, team1Name: p1.name, team2Name: p2.name } : {}),
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
              round: roundNum, bracketPosition: i, bracketRound: rName, roundLabel: rName,
              stageId: finalsStageId2,
              player1Id: "", player2Id: "",
              player1Name: `${prevRName} 승자${i * 2 + 1}`, player2Name: `${prevRName} 승자${i * 2 + 2}`,
              ...(tour2.type === "team" || tour2.type === "randomTeamLeague" ? { team1Id: "", team2Id: "", team1Name: `${prevRName} 승자${i * 2 + 1}`, team2Name: `${prevRName} 승자${i * 2 + 2}` } : {}),
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
            round: roundNum, bracketRound: "3/4위", roundLabel: "3/4위 결정전", stageId: `${finalsStageId2}_3rd`,
            player1Id: "", player2Id: "", player1Name: "4강 패자1", player2Name: "4강 패자2",
            ...(tour2.type === "team" || tour2.type === "randomTeamLeague" ? { team1Id: "", team2Id: "", team1Name: "4강 패자1", team2Name: "4강 패자2" } : {}),
            sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
            currentSet: 0, player1Timeouts: 0, player2Timeouts: 0,
            winnerId: null, createdAt: now2 + mc,
            sourceMatch1: sfKeys?.[0], sourceMatch2: sfKeys?.[1], sourceType: "loser",
          };
          summary.push("\n[ 3/4위 결정전 ] 1경기");
          mc++;
        }

        // 순위 결정전: 탈락자를 티어별로 분류
        // rankingUpTo > 0이면 해당 순위까지만 순위 결정전 진행
        const doRanking = rankingUpTo > 0 || includeFifthToEighth2 || includeClassification2;
        if (doRanking && eliminated.length >= 2) {
          const isTeamTour2 = tour2.type === "team" || tour2.type === "randomTeamLeague";
          const elimTeamData = isTeamTour2
            ? await db.ref(`teams/${tid}`).once("value").then(s => s.exists() ? s.val() as Record<string, { memberIds?: string[]; memberNames?: string[]; coachName?: string }> : {})
            : {};

          const classGroupSize = (rankingConfig2?.classificationGroupSize as number) || 8;
          const tierSize = Math.max(4, classGroupSize);
          const advCount = advanced.length;

          // rankingUpTo가 설정되면 해당 순위까지의 탈락자만 사용
          const maxRankingSlots = rankingUpTo > 0 ? Math.max(0, rankingUpTo - advCount) : eliminated.length;
          const rankableEliminated = eliminated.slice(0, Math.min(maxRankingSlots, eliminated.length));

          const tiers: Array<{ label: string; members: typeof eliminated }> = [];

          if (rankableEliminated.length >= 2) {
            // rankingUpTo만 설정된 경우 (fifthToEighth/classification 없이)
            // → tierSize 단위로 자동 분류
            if (rankingUpTo > 0 && !includeFifthToEighth2 && !includeClassification2) {
              let remaining = [...rankableEliminated];
              let tierStart = advCount + 1;
              while (remaining.length >= 2) {
                const tierMembers = remaining.slice(0, tierSize);
                const tierEnd = tierStart + tierMembers.length - 1;
                tiers.push({ label: `${tierStart}~${tierEnd}위 순위 결정전`, members: tierMembers });
                remaining = remaining.slice(tierSize);
                tierStart = tierEnd + 1;
              }
            } else if (includeFifthToEighth2) {
              const first4 = rankableEliminated.slice(0, Math.min(4, rankableEliminated.length));
              if (first4.length >= 2) {
                tiers.push({ label: `${advCount + 1}~${advCount + first4.length}위 순위 결정전`, members: first4 });
              }
              if (includeClassification2 || rankingUpTo > 0) {
                let remaining = rankableEliminated.slice(Math.min(4, rankableEliminated.length));
                let tierStart = advCount + 5;
                while (remaining.length >= 2) {
                  const tierMembers = remaining.slice(0, tierSize);
                  const tierEnd = tierStart + tierMembers.length - 1;
                  tiers.push({ label: `${tierStart}~${tierEnd}위 순위 결정전`, members: tierMembers });
                  remaining = remaining.slice(tierSize);
                  tierStart = tierEnd + 1;
                }
              }
            } else if (includeClassification2) {
              let remaining = [...rankableEliminated];
              let tierStart = advCount + 1;
              while (remaining.length >= 2) {
                const tierMembers = remaining.slice(0, tierSize);
                const tierEnd = tierStart + tierMembers.length - 1;
                tiers.push({ label: `${tierStart}~${tierEnd}위 순위 결정전`, members: tierMembers });
                remaining = remaining.slice(tierSize);
                tierStart = tierEnd + 1;
              }
            }
          }

          // 각 티어별 라운드로빈 경기 생성
          for (let t = 0; t < tiers.length; t++) {
            const tier = tiers[t];
            let tierMc = 0;
            for (let i = 0; i < tier.members.length; i++) {
              for (let j = i + 1; j < tier.members.length; j++) {
                const e1 = tier.members[i], e2 = tier.members[j];
                const mKey = db.ref(`matches/${tid}`).push().key!;
                const t1d = elimTeamData[e1.id] || {};
                const t2d = elimTeamData[e2.id] || {};
                bulk2[`matches/${tid}/${mKey}`] = {
                  tournamentId: tid, type: tour2.type || "individual", status: "pending",
                  round: tierMc + 1, stageId: `${finalsStageId2}_class_${t}`,
                  bracketRound: tier.label, roundLabel: tier.label,
                  player1Id: e1.id, player2Id: e2.id,
                  player1Name: e1.name, player2Name: e2.name,
                  ...(isTeamTour2 ? {
                    team1Id: e1.id, team2Id: e2.id, team1Name: e1.name, team2Name: e2.name,
                    team1: { memberIds: t1d.memberIds || [], memberNames: t1d.memberNames || [], coachName: t1d.coachName || "" },
                    team2: { memberIds: t2d.memberIds || [], memberNames: t2d.memberNames || [], coachName: t2d.coachName || "" },
                    player1Coach: t1d.coachName || "", player2Coach: t2d.coachName || "",
                  } : {}),
                  sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
                  currentSet: 0, player1Timeouts: 0, player2Timeouts: 0,
                  winnerId: null, createdAt: now2 + mc,
                };
                mc++; tierMc++;
              }
            }
            summary.push(`[ ${tier.label} ] ${tier.members.length}명, ${tierMc}경기`);
          }
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

        // 대회의 scheduleDates 확인
        const schedTourSnap = await db.ref(`tournaments/${tid}`).once("value");
        const schedTourData = schedTourSnap.exists() ? schedTourSnap.val() as Record<string, unknown> : {};
        const scheduleDates: string[] = Array.isArray(schedTourData.scheduleDates) ? schedTourData.scheduleDates as string[] : [];

        // scheduleDates가 있으면 다음 날짜를 scheduleDates에서 가져옴
        const getNextScheduleDate = (currentDate: string): string => {
          if (scheduleDates.length > 0) {
            const next = scheduleDates.find(d => d > currentDate);
            return next || addDays(currentDate, 1);
          }
          return addDays(currentDate, 1);
        };

        // 시작 날짜: scheduleDates가 있으면 가장 가까운 유효 날짜 사용
        let effectiveStartDate = scheduleDate;
        if (scheduleDates.length > 0) {
          const validDate = scheduleDates.find(d => d >= scheduleDate);
          if (validDate) effectiveStartDate = validDate;
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
        const courtSlots = courtList.map((c) => ({ courtId: c.id, courtName: c.name, date: effectiveStartDate, time: dayStart }));

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

            // 마감 초과 시 다음 경기일로
            if (candidateTime >= dayEnd) {
              candidateDate = getNextScheduleDate(candidateDate);
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
            bestDate = getNextScheduleDate(bestDate);
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
            court.date = getNextScheduleDate(bestDate);
            court.time = nextDayStartMin;
          } else {
            court.date = bestDate;
            court.time = courtEndTime;
          }

          // 선수 마지막 종료 시간 업데이트 (playerRest 적용)
          const playerEndTime = bestTime + playerRest;
          const playerEnd = playerEndTime >= dayEnd
            ? { date: getNextScheduleDate(bestDate), time: nextDayStartMin }
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

        // 상세 스케줄 (AI가 정확한 정보를 표시하도록)
        const scheduleDetail = slots.map(s => `${s.scheduledDate} ${s.scheduledTime} [${s.courtName}] ${s.label}`).join("\n");

        return JSON.stringify({
          success: true,
          count: slots.length,
          skipped: skippedCount,
          dates: dates.length,
          summary,
          scheduleDetail,
          settings: { interval, playerRest, breakTime: breakStartStr ? `${breakStartStr}-${breakEndStr}` : "없음", endTime },
          message: `${slots.length}경기 스케줄 생성 완료 (${dates.length}일, 팀 휴식 ${playerRest}분, 경기 간격 ${interval}분${breakStartStr ? `, 점심 ${breakStartStr}-${breakEndStr}` : ""})`,
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
        // 기존 코트 중복 확인
        const existingCourts = await db.ref("courts").once("value");
        if (existingCourts.exists()) {
          for (const [cid, cv] of Object.entries(existingCourts.val() as Record<string, { name: string }>)) {
            if (cv.name === input.name) {
              return JSON.stringify({ success: true, courtId: cid, message: `코트 "${input.name}"은(는) 이미 등록되어 있습니다. (기존 ID: ${cid})`, existing: true });
            }
          }
        }
        const newRef = db.ref("courts").push();
        await newRef.set({ name: input.name, location: input.location || "", assignedReferees: [], createdAt: Date.now() });
        return JSON.stringify({ success: true, courtId: newRef.key, message: `코트 "${input.name}" 추가 완료` });
      }

      case "add_referee": {
        // 기존 심판 중복 확인
        const existingRefs = await db.ref("referees").once("value");
        if (existingRefs.exists()) {
          for (const [rid, rv] of Object.entries(existingRefs.val() as Record<string, { name: string }>)) {
            if (rv.name === input.name) {
              return JSON.stringify({ success: true, refereeId: rid, message: `심판 "${input.name}"은(는) 이미 등록되어 있습니다. (기존 ID: ${rid})`, existing: true });
            }
          }
        }
        const newRef = db.ref("referees").push();
        await newRef.set({ name: input.name, role: input.role || "main", createdAt: Date.now() });
        return JSON.stringify({ success: true, refereeId: newRef.key, message: `심판 "${input.name}" 추가 완료` });
      }

      case "delete_referee": {
        await db.ref(`referees/${input.refereeId}`).remove();
        return JSON.stringify({ success: true, message: "심판 삭제 완료" });
      }

      case "update_referee": {
        const { refereeId: rid, ...rFields } = input;
        await db.ref(`referees/${rid}`).update(rFields);
        return JSON.stringify({ success: true, message: "심판 정보 수정 완료" });
      }

      case "delete_court": {
        await db.ref(`courts/${input.courtId}`).remove();
        return JSON.stringify({ success: true, message: "코트 삭제 완료" });
      }

      case "update_court": {
        const { courtId: cid, ...cFields } = input;
        await db.ref(`courts/${cid}`).update(cFields);
        return JSON.stringify({ success: true, message: "코트 정보 수정 완료" });
      }

      case "update_player": {
        const { playerId: pid, tournamentId: ptid, ...pFields } = input;
        const pPath = ptid ? `tournamentPlayers/${ptid}/${pid}` : `players/${pid}`;
        await db.ref(pPath).update(pFields);
        return JSON.stringify({ success: true, message: "선수 정보 수정 완료" });
      }

      case "bulk_assign_referees": {
        const btid = input.tournamentId as string;
        const mSnap = await db.ref(`matches/${btid}`).once("value");
        const rSnap = await db.ref("referees").once("value");
        if (!mSnap.exists()) return JSON.stringify({ error: "경기가 없습니다." });
        if (!rSnap.exists()) return JSON.stringify({ error: "심판이 없습니다." });

        const refList = Object.entries(rSnap.val() as Record<string, { name: string }>);
        const bulkR: Record<string, unknown> = {};
        let rIdx = 0;
        let cnt = 0;
        for (const [mid, mv] of Object.entries(mSnap.val() as Record<string, Record<string, unknown>>)) {
          if (mv.refereeId || mv.status === "completed") continue;
          const [refId, refData] = refList[rIdx % refList.length];
          bulkR[`matches/${btid}/${mid}/refereeId`] = refId;
          bulkR[`matches/${btid}/${mid}/refereeName`] = refData.name;
          rIdx++;
          cnt++;
        }
        if (cnt > 0) await db.ref().update(bulkR);
        return JSON.stringify({ success: true, count: cnt, message: `${cnt}경기에 심판 자동 배정 완료` });
      }

      case "reset_schedule": {
        const rstid = input.tournamentId as string;
        const rstSnap = await db.ref(`matches/${rstid}`).once("value");
        if (rstSnap.exists()) {
          const rstBulk: Record<string, unknown> = {};
          for (const mid of Object.keys(rstSnap.val() as Record<string, unknown>)) {
            rstBulk[`matches/${rstid}/${mid}/scheduledTime`] = null;
            rstBulk[`matches/${rstid}/${mid}/scheduledDate`] = null;
            rstBulk[`matches/${rstid}/${mid}/courtId`] = null;
            rstBulk[`matches/${rstid}/${mid}/courtName`] = null;
          }
          await db.ref().update(rstBulk);
        }
        await db.ref(`schedule/${rstid}`).remove();
        return JSON.stringify({ success: true, message: "스케줄 초기화 완료" });
      }

      case "add_team": {
        const ttid = input.tournamentId as string;
        const tRef = db.ref(`teams/${ttid}`).push();
        const teamPayload: Record<string, unknown> = {
          name: input.name,
          memberIds: input.memberIds || [],
          memberNames: input.memberNames || [],
          createdAt: Date.now(),
        };
        if (input.coachName) teamPayload.coachName = input.coachName;
        await tRef.set(teamPayload);
        return JSON.stringify({ success: true, teamId: tRef.key, message: `팀 "${input.name}" 추가 완료${input.coachName ? ` (코치: ${input.coachName})` : ""}` });
      }

      case "delete_team": {
        await db.ref(`teams/${input.tournamentId}/${input.teamId}`).remove();
        return JSON.stringify({ success: true, message: "팀 삭제 완료" });
      }

      case "list_teams": {
        const tSnap = await db.ref(`teams/${input.tournamentId}`).once("value");
        if (!tSnap.exists()) return JSON.stringify([]);
        return JSON.stringify(Object.entries(tSnap.val()).map(([id, v]) => ({ id, ...(v as object) })));
      }

      // ===== 워크플로우 핸들러 =====

      case "create_team_league": {
        const steps: string[] = [];
        const tlIsFullLeague = (input.format as string) === "full_league" || (input.groupCount as number) === 1;
        const tlGroupCount = tlIsFullLeague ? 1 : ((input.groupCount as number) || 2);

        // 1. 대회 생성
        const tlResult = await executeTool("setup_full_tournament", {
          name: input.name, date: input.date, endDate: input.endDate,
          groupId: input.groupId, groupName: input.groupName,
          scheduleDates: input.scheduleDates,
          type: (input.randomTeam as boolean) ? "randomTeamLeague" : "team",
          teams: input.teams,
          groupCount: tlGroupCount,
          advancePerGroup: tlIsFullLeague ? 0 : ((input.advancePerGroup as number) || 2),
          qualifyingWinScore: (input.qualifyingWinScore as number) || 31,
          qualifyingSetsToWin: 1,
          finalsFormat: (input.finalsFormat as string) || "single_elimination",
          finalsStartRound: input.finalsStartRound,
          avoidSameGroup: input.avoidSameGroup,
          bracketArrangement: input.bracketArrangement,
          thirdPlace: input.thirdPlace !== false,
          fifthToEighth: input.fifthToEighth !== false,
          fifthToEighthFormat: input.fifthToEighthFormat,
          classificationGroups: input.classificationGroups,
          classificationGroupSize: input.classificationGroupSize,
          rankingUpTo: input.rankingUpTo,
          teamSize: input.teamSize, maxReserves: input.maxReserves,
          genderRatio: input.genderRatio,
          rotationEnabled: input.rotationEnabled, rotationInterval: input.rotationInterval,
          minLead: input.minLead, deuceEnabled: input.deuceEnabled,
          seeds: input.seeds, tiebreakerRules: input.tiebreakerRules,
          wildcardCount: input.wildcardCount,
        });
        const tlParsed = JSON.parse(tlResult);
        if (!tlParsed.success) return JSON.stringify({ error: `대회 생성 실패: ${tlParsed.error}` });
        const tlTid = tlParsed.tournamentId as string;
        steps.push(`대회 생성 완료: ${tlParsed.matchCount}경기 (${tlParsed.groupCount}개 조)`);

        // 2. 코트 등록
        for (const court of ((input.courts as string[]) || [])) {
          await executeTool("add_court", { name: court });
        }
        if ((input.courts as string[])?.length) steps.push(`경기장 ${(input.courts as string[]).length}개 등록`);

        // 3. 심판 등록
        for (const ref of ((input.referees as string[]) || [])) {
          await executeTool("add_referee", { name: ref, role: "main" });
        }
        if ((input.referees as string[])?.length) steps.push(`심판 ${(input.referees as string[]).length}명 등록`);

        // 4. 스케줄 생성
        const matchDur = (input.matchDurationMinutes as number) || 60;
        const teamRest = (input.teamRestMinutes as number) || 30;
        const schedResult = await executeTool("generate_schedule", {
          tournamentId: tlTid, scheduleDate: input.date as string,
          startTime: (input.startTime as string) || "09:00",
          endTime: (input.endTime as string) || "18:00",
          nextDayStartTime: (input.nextDayStartTime as string) || (input.startTime as string) || "09:00",
          intervalMinutes: matchDur, playerRestMinutes: matchDur + teamRest,
          ...(input.breakStart ? { breakStart: input.breakStart } : {}),
          ...(input.breakEnd ? { breakEnd: input.breakEnd } : {}),
        });
        const schedParsed = JSON.parse(schedResult);
        if (schedParsed.success) steps.push(`스케줄: ${schedParsed.summary}`);

        // 5. 심판 자동 배정
        if ((input.referees as string[])?.length) {
          await executeTool("bulk_assign_referees", { tournamentId: tlTid });
          steps.push("심판 자동 배정 완료");
        }

        return JSON.stringify({
          success: true, tournamentId: tlTid, steps,
          groupAssignment: tlParsed.groupAssignment,
          teamRoster: tlParsed.message,
          scheduleDetail: schedParsed.scheduleDetail || "",
          matchCount: tlParsed.matchCount, groupCount: tlParsed.groupCount,
        });
      }

      case "create_individual_tournament": {
        const steps: string[] = [];
        const setsToWin = (input.setsToWin as number) || 2;
        const matchDur = (input.matchDurationMinutes as number) || 30;
        const pRest = (input.playerRestMinutes as number) || 30;
        const isFullLeagueReq = (input.format as string) === "full_league" || (input.groupCount as number) === 1;
        const itGroupCount = isFullLeagueReq ? 1 : ((input.groupCount as number) || 4);

        const itResult = await executeTool("setup_full_tournament", {
          name: input.name, date: input.date, endDate: input.endDate,
          groupId: input.groupId, groupName: input.groupName,
          scheduleDates: input.scheduleDates,
          type: "individual", players: input.players,
          groupCount: itGroupCount,
          advancePerGroup: isFullLeagueReq ? 0 : ((input.advancePerGroup as number) || 2),
          qualifyingWinScore: (input.winScore as number) || 11,
          qualifyingSetsToWin: setsToWin,
          finalsFormat: (input.finalsFormat as string) || "single_elimination",
          finalsSetsToWin: input.finalsSetsToWin,
          finalsStartRound: input.finalsStartRound,
          avoidSameGroup: input.avoidSameGroup,
          bracketArrangement: input.bracketArrangement,
          thirdPlace: isFullLeagueReq ? false : (input.thirdPlace !== false),
          fifthToEighth: input.fifthToEighth,
          fifthToEighthFormat: input.fifthToEighthFormat,
          classificationGroups: input.classificationGroups,
          classificationGroupSize: input.classificationGroupSize,
          rankingUpTo: input.rankingUpTo,
          minLead: input.minLead, deuceEnabled: input.deuceEnabled,
          seeds: input.seeds, tiebreakerRules: input.tiebreakerRules,
          wildcardCount: input.wildcardCount,
          roundOverrideFromRound: input.roundOverrideFromRound,
          roundOverrideSetsToWin: input.roundOverrideSetsToWin,
        });
        const itParsed = JSON.parse(itResult);
        if (!itParsed.success) return JSON.stringify({ error: `대회 생성 실패: ${itParsed.error}` });
        const itTid = itParsed.tournamentId as string;
        steps.push(isFullLeagueReq
          ? `대회 생성: 풀리그 ${itParsed.matchCount}경기`
          : `대회 생성: ${itParsed.matchCount}경기 (${itParsed.groupCount}개 조)`);

        for (const c of ((input.courts as string[]) || [])) await executeTool("add_court", { name: c });
        for (const r of ((input.referees as string[]) || [])) await executeTool("add_referee", { name: r, role: "main" });

        const itSched = await executeTool("generate_schedule", {
          tournamentId: itTid, scheduleDate: input.date as string,
          startTime: (input.startTime as string) || "09:00",
          endTime: (input.endTime as string) || "18:00",
          nextDayStartTime: (input.nextDayStartTime as string) || (input.startTime as string) || "09:00",
          intervalMinutes: matchDur, playerRestMinutes: matchDur + pRest,
          ...(input.breakStart ? { breakStart: input.breakStart } : {}),
          ...(input.breakEnd ? { breakEnd: input.breakEnd } : {}),
        });
        const itSchedP = JSON.parse(itSched);
        if (itSchedP.success) steps.push(`스케줄: ${itSchedP.summary}`);
        if ((input.referees as string[])?.length) {
          await executeTool("bulk_assign_referees", { tournamentId: itTid });
          steps.push("심판 자동 배정");
        }

        return JSON.stringify({
          success: true, tournamentId: itTid, steps,
          groupAssignment: itParsed.groupAssignment,
          scheduleDetail: itSchedP.scheduleDetail || "",
          matchCount: itParsed.matchCount, groupCount: itParsed.groupCount,
        });
      }

      case "run_full_simulation": {
        const tid = input.tournamentId as string;
        const allSteps: string[] = [];

        const tourSnap = await db.ref(`tournaments/${tid}`).once("value");
        if (!tourSnap.exists()) return JSON.stringify({ error: "대회를 찾을 수 없습니다." });
        const tourData = tourSnap.val() as Record<string, unknown>;
        const isTeam = tourData.type === "team" || tourData.type === "randomTeamLeague";

        // 풀리그 여부 확인
        const simTourFormat = tourData.format as string || "";
        const simIsFullLeague = simTourFormat === "full_league" || tourData.formatType === "round_robin";

        // 1. 리그/예선 시뮬레이션
        const simResult = await executeTool("simulate_matches", { tournamentId: tid });
        const simParsed = JSON.parse(simResult);
        if (!simParsed.success) return JSON.stringify({ error: `${simIsFullLeague ? "리그" : "예선"} 시뮬레이션 실패: ${simParsed.error}` });
        allSteps.push(`${simIsFullLeague ? "리그" : "예선"} ${simParsed.count}경기 완료`);

        // 2. 결승 생성 (풀리그는 결승 없이 리그전만 진행)
        if (!simIsFullLeague) {
          const mSnap = await db.ref(`matches/${tid}`).once("value");
          const allM = mSnap.exists() ? Object.values(mSnap.val() as Record<string, Record<string, unknown>>) : [];
          const hasFinals = allM.some(m => ((m.stageId as string) || "").includes("finals") || ((m.stageId as string) || "").includes("ranking"));

          if (!hasFinals) {
            const rc = tourData.rankingMatchConfig as Record<string, unknown> | undefined;
            const genR = await executeTool("generate_finals", {
              tournamentId: tid,
              advancePerGroup: ((tourData.finalsConfig as Record<string, unknown>)?.advancePerGroup as number) || 2,
              includeThirdPlace: true,
              includeFifthToEighth: rc?.fifthToEighth !== false,
            });
            const genP = JSON.parse(genR);
            if (genP.success) {
              allSteps.push(`본선 ${genP.matchCount}경기 생성`);
              // 반복 시뮬레이션: 4강→결승 등 sourceMatch 전파 후 새로 채워진 경기까지 처리
              for (let round = 0; round < 5; round++) {
                const finSim = await executeTool("simulate_matches", { tournamentId: tid });
                const finP = JSON.parse(finSim);
                if (finP.success && finP.count > 0) {
                  allSteps.push(`본선 라운드${round + 1}: ${finP.count}경기 완료`);
                } else {
                  break; // 더 이상 시뮬레이션할 경기 없음
                }
              }
            }
          } else {
            // 이미 결승이 있으면 미완료 경기 반복 시뮬레이션
            for (let round = 0; round < 5; round++) {
              const finSim = await executeTool("simulate_matches", { tournamentId: tid });
              const finP = JSON.parse(finSim);
              if (finP.success && finP.count > 0) {
                allSteps.push(`추가 라운드${round + 1}: ${finP.count}경기 완료`);
              } else {
                break;
              }
            }
          }
        }

        // 3. 대회 완료
        await db.ref(`tournaments/${tid}/status`).set("completed");

        // 4. 조별 순위 계산 (프론트엔드 calculateIndividualRanking과 동일: 승수→세트득실→점수득실)
        const finalSnap = await db.ref(`matches/${tid}`).once("value");
        const finalM = finalSnap.exists() ? Object.entries(finalSnap.val() as Record<string, Record<string, unknown>>) : [];
        const gStats = new Map<string, Map<string, { name: string; wins: number; losses: number; setsWon: number; setsLost: number; pf: number; pa: number }>>();
        for (const [, m] of finalM) {
          if (m.status !== "completed") continue;
          // 풀리그: groupId 없는 리그 경기도 포함, 본선/순위결정전은 제외
          const sid = (m.stageId as string) || "";
          if (sid.includes("finals") || sid.includes("ranking") || sid.includes("3rd") || sid.includes("5to8")) continue;
          const gid = (m.groupId as string) || "full_league";
          if (!gStats.has(gid)) gStats.set(gid, new Map());
          const st = gStats.get(gid)!;
          const n1 = (m.team1Name || m.player1Name) as string, n2 = (m.team2Name || m.player2Name) as string;
          const id1 = (m.team1Id || m.player1Id) as string, id2 = (m.team2Id || m.player2Id) as string;
          if (!st.has(id1)) st.set(id1, { name: n1, wins: 0, losses: 0, setsWon: 0, setsLost: 0, pf: 0, pa: 0 });
          if (!st.has(id2)) st.set(id2, { name: n2, wins: 0, losses: 0, setsWon: 0, setsLost: 0, pf: 0, pa: 0 });
          if (m.winnerId === id1) { st.get(id1)!.wins++; st.get(id2)!.losses++; }
          else if (m.winnerId === id2) { st.get(id2)!.wins++; st.get(id1)!.losses++; }
          for (const s of ((m.sets || []) as Array<{ player1Score: number; player2Score: number }>)) {
            if (s.player1Score > s.player2Score) { st.get(id1)!.setsWon++; st.get(id2)!.setsLost++; }
            else if (s.player2Score > s.player1Score) { st.get(id2)!.setsWon++; st.get(id1)!.setsLost++; }
            st.get(id1)!.pf += s.player1Score; st.get(id1)!.pa += s.player2Score;
            st.get(id2)!.pf += s.player2Score; st.get(id2)!.pa += s.player1Score;
          }
        }
        const groupRankings = [...gStats.entries()].sort().map(([gid, stats]) => {
          const sorted = [...stats.values()].sort((a, b) => {
            if (b.wins !== a.wins) return b.wins - a.wins;
            const aSetDiff = a.setsWon - a.setsLost, bSetDiff = b.setsWon - b.setsLost;
            if (bSetDiff !== aSetDiff) return bSetDiff - aSetDiff;
            return (b.pf - b.pa) - (a.pf - a.pa);
          });
          const header = gid === "full_league" ? "최종 순위" : `${gid} 순위`;
          const tableHeader = "순위 | 이름 | 승 | 패 | 세트(승-패) | 득점-실점";
          const separator = "---|---|---|---|---|---";
          const rows = sorted.map((s, i) =>
            `${i + 1}위 | ${s.name} | ${s.wins}승 | ${s.losses}패 | ${s.setsWon}-${s.setsLost} | ${s.pf}-${s.pa}`
          ).join("\n");
          return `${header}:\n${tableHeader}\n${separator}\n${rows}`;
        }).join("\n\n");

        // 5. 본선 결과 (서브 기준 점수)
        const finalsResults = finalM
          .filter(([, m]) => m.status === "completed" && ((m.stageId as string) || "").match(/finals|ranking|3rd|5to8/))
          .map(([, m]) => {
            const n1 = (m.team1Name || m.player1Name) as string, n2 = (m.team2Name || m.player2Name) as string;
            const winner = m.winnerId === (m.team1Id || m.player1Id) ? n1 : n2;
            const label = (m.roundLabel || m.bracketRound || "본선") as string;
            const sets = (m.sets || []) as Array<{ player1Score: number; player2Score: number }>;
            // 서브 기준 점수 계산
            const ctWinner = m.coinTossWinner as string || "player1";
            const ctChoice = m.coinTossChoice as string || "serve";
            const fServer = ctChoice === "serve" ? ctWinner : (ctWinner === "player1" ? "player2" : "player1");
            const scoreStr = sets.map((s, si) => {
              const srv = si % 2 === 0 ? fServer : (fServer === "player1" ? "player2" : "player1");
              const srvScore = srv === "player1" ? s.player1Score : s.player2Score;
              const rcvScore = srv === "player1" ? s.player2Score : s.player1Score;
              return `${srvScore}-${rcvScore}`;
            }).join(", ");
            return `[${label}] ${n1} vs ${n2} → ${winner} 승 (${scoreStr})`;
          }).join("\n");

        // 6. 팀 로스터
        let teamRoster = "";
        if (isTeam) {
          const tSnap = await db.ref(`teams/${tid}`).once("value");
          if (tSnap.exists()) {
            teamRoster = Object.values(tSnap.val() as Record<string, { name: string; memberNames?: string[]; coachName?: string }>)
              .map(t => `${t.name}: ${(t.memberNames || []).join(", ")}${t.coachName ? ` (코치: ${t.coachName})` : ""}`).join("\n");
          }
        }

        return JSON.stringify({
          success: true, steps: allSteps, groupRankings, finalsResults, teamRoster,
          totalMatches: finalM.length,
          completedMatches: finalM.filter(([, m]) => m.status === "completed").length,
        });
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
