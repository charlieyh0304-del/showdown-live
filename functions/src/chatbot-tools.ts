import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { getTournamentRankings } from "./handlers/rankings";
import {
  listTournaments, getTournament, listPlayers, listMatches,
  listCourts, listReferees, getSchedule, listTeams,
} from "./handlers/reads";
import {
  addCourt, deleteCourt, updateCourt,
  addReferee, deleteReferee, updateReferee, bulkAssignReferees,
  updatePlayer, addTeam, deleteTeam, resetSchedule,
} from "./handlers/crud";
import { createTournament, updateTournament, deleteTournament } from "./handlers/tournaments";
import { addMatch, updateMatch, deleteMatch } from "./handlers/matches";
import { addPlayersBulk, deletePlayer } from "./handlers/players";
import { generateRoundRobin, shiftSchedule, moveMatchesToCourt, generateSchedule } from "./handlers/schedule";
import { setupRandomTeamLeague } from "./handlers/setup-random";
import { setupFullTournament } from "./handlers/setup-full";
import { simulateMatches } from "./handlers/simulate";
import { generateFinals } from "./handlers/generate-finals";
import { createTeamLeague } from "./handlers/create-team-league";
import { createIndividualTournament } from "./handlers/create-individual-tournament";
import { runFullSimulation } from "./handlers/run-full-simulation";

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
  {
    name: "get_tournament_rankings",
    description: "대회 순위 조회. 완료된 경기 기반으로 1위부터 최하위까지 전체 순위 반환. 1위/우승자/순위/결과/누가 이겼는지 등 모든 순위 관련 질문에 사용. 본선/순위결정전/조별리그 결과 포함.",
    input_schema: {
      type: "object" as const,
      properties: {
        tournamentId: { type: "string", description: "대회 ID" },
        topN: { type: "number", description: "상위 N명만 반환 (기본: 전체)" },
      },
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
    description: "대회 정보 수정. 변경할 필드만 전달. 순위 표시 범위(rankingUpTo) 변경, 3/4위/5-8위/하위순위결정전 활성화 변경 등 가능.",
    input_schema: {
      type: "object" as const,
      properties: {
        tournamentId: { type: "string" },
        name: { type: "string" },
        date: { type: "string" },
        status: { type: "string", enum: ["draft", "registration", "in_progress", "paused", "completed"] },
        rankingUpTo: { type: "number", description: "순위 표시 범위 (N위까지만 표시). 예: 8 → 1~8위만" },
        thirdPlace: { type: "boolean", description: "3/4위 결정전 활성화" },
        fifthToEighth: { type: "boolean", description: "5~8위 결정전 활성화" },
        classificationGroups: { type: "boolean", description: "9위 이하 하위 순위결정전 활성화" },
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
  {
    name: "add_referee",
    description: "심판 등록. 동일 이름이 이미 있으면 기존 ID 반환. PIN 입력 시 서버에서 PBKDF2 해싱 후 저장 (심판 로그인용).",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "심판 이름" },
        role: { type: "string", enum: ["main", "assistant"], description: "main(주심) 또는 assistant(부심), 기본값 main" },
        pin: { type: "string", description: "심판 로그인 PIN(선택). 입력 시 서버에서 해싱하여 저장." },
      },
      required: ["name"],
    },
  },
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
    description: "팀전/팀 리그전 원스톱 생성. 대회 생성→코트→심판→스케줄→심판배정 한번에 처리. 지원 기능: 조별리그+본선 토너먼트, 풀리그, 와일드카드 진출(wildcardCount), 탑시드(seeds), 점심시간(breakStart/breakEnd), 3/4위전·5~8위전·하위순위결정전(classificationGroups: 9-16위,17-24위 등 자동 다중티어), 라운드별 세트오버라이드, 대회그룹(groupId). 모든 세부 설정이 파라미터로 가능하므로 수동 구성 불필요.",
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
    description: "개인전 원스톱 생성. 대회 생성→코트→심판→스케줄→심판배정 한번에 처리. 지원 기능: 조별리그+본선 토너먼트(group_knockout), 풀리그(full_league), 와일드카드 진출(wildcardCount: 조 3위 중 상위 N명 추가진출), 탑시드 분산배치(seeds), 점심시간(breakStart/breakEnd), 3/4위전(thirdPlace)·5~8위전(fifthToEighth)·하위순위결정전(classificationGroups: 9-16위,17-24위,25-32위 등 자동 다중티어 생성), 라운드별 세트오버라이드(roundOverrideFromRound), 순위범위제한(rankingUpTo), 대회그룹(groupId). 모든 세부 설정이 파라미터로 가능하므로 수동 구성 불필요.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "대회 이름" },
        date: { type: "string", description: "시작일 YYYY-MM-DD" },
        endDate: { type: "string", description: "종료일 (선택)" },
        scheduleDates: { type: "array", items: { type: "string" }, description: "경기 진행 날짜 목록 YYYY-MM-DD (여러 주에 걸쳐 진행 시). 예: ['2026-04-05','2026-04-12']. 미지정 시 date부터 연속 날짜" },
        players: { type: "array", items: { type: "object", properties: { name: { type: "string" }, gender: { type: "string" }, club: { type: "string" }, class: { type: "string" } }, required: ["name"] }, description: "선수 목록" },
        format: { type: "string", enum: ["full_league", "group_knockout"], description: "대회 방식. 풀리그(전원 라운드로빈)=full_league, 조별리그+토너먼트=group_knockout (기본 group_knockout)" },
        groupCount: { type: "number", description: "조 수. 풀리그(full_league)면 무시됨. 조별리그 기본 4" },
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
        rankingSetsToWin: { type: "number", description: "순위 결정전 세트 수 (3세트=2, 5세트=3). 미지정 시 예선과 동일" },
        rankingWinScore: { type: "number", description: "순위 결정전 승리 점수. 미지정 시 예선과 동일" },
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
    description: "전체 시뮬레이션 (완전 자동). tournamentId만 전달하면 예선→본선 16강~결승→3/4위전→5~8위 결정전(8강 패자)→9~16위 순위결정전(16강 패자 라운드로빈)→17~24위, 25~32위 하위순위결정전까지 모든 경기를 자동 생성+시뮬레이션+순위 계산. 수동 추가 불필요. 결과에 전체 순위(1위~최하위), 본선 결과, 조별 순위 포함.",
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
        return await listTournaments();
      }

      case "get_tournament":
        return await getTournament(input.tournamentId as string);

      case "list_players":
        return await listPlayers(input.tournamentId as string | undefined);

      case "list_matches":
        return await listMatches(input.tournamentId as string, input.status as string | undefined);

      case "list_courts":
        return await listCourts();

      case "list_referees":
        return await listReferees();

      case "get_schedule": {
        return await getSchedule(input.tournamentId as string);
      }

      case "get_tournament_rankings": {
        const result = await getTournamentRankings(
          input.tournamentId as string,
          input.topN as number | undefined,
        );
        return JSON.stringify(result);
      }

      // --- Write: Tournament ---
      case "create_tournament":
        return await createTournament(input);

      case "setup_random_team_league":
        return await setupRandomTeamLeague(input);

      case "setup_full_tournament":
        return await setupFullTournament(input);

      case "update_tournament":
        return await updateTournament(input);

      case "delete_tournament":
        return await deleteTournament(input.tournamentId as string, input.adminPin as string);

      // --- Write: Players ---
      case "add_players_bulk":
        return await addPlayersBulk(
          input.players as Array<{ name: string; club?: string; class?: string; gender?: string }>,
          input.tournamentId as string | undefined,
        );

      case "delete_player":
        return await deletePlayer(input.playerId as string, input.tournamentId as string | undefined);

      // --- Write: Matches ---
      case "add_match":
        return await addMatch(input);

      case "update_match":
        return await updateMatch(input);

      case "delete_match":
        return await deleteMatch(input.tournamentId as string, input.matchId as string);

      case "generate_round_robin":
        return await generateRoundRobin(input);

      // --- Write: Schedule (고급) ---
      case "simulate_matches":
        return await simulateMatches(input, executeTool);

      case "generate_finals":
        return await generateFinals(input);

      case "generate_schedule":
        return await generateSchedule(input);


      case "shift_schedule":
        return await shiftSchedule(input);

      case "move_matches_to_court":
        return await moveMatchesToCourt(input);

      // --- Write: Courts & Referees ---
      case "add_court":
        return await addCourt(input.name as string, input.location as string | undefined);

      case "add_referee":
        return await addReferee(input.name as string, input.role as string | undefined, input.pin as string | undefined);

      case "delete_referee":
        return await deleteReferee(input.refereeId as string);

      case "update_referee": {
        const { refereeId: rid, ...rFields } = input;
        return await updateReferee(rid as string, rFields);
      }

      case "delete_court":
        return await deleteCourt(input.courtId as string);

      case "update_court": {
        const { courtId: cid, ...cFields } = input;
        return await updateCourt(cid as string, cFields);
      }

      case "update_player": {
        const { playerId: pid, tournamentId: ptid, ...pFields } = input;
        return await updatePlayer(pid as string, ptid as string | undefined, pFields);
      }

      case "bulk_assign_referees":
        return await bulkAssignReferees(input.tournamentId as string);

      case "reset_schedule":
        return await resetSchedule(input.tournamentId as string);

      case "add_team":
        return await addTeam(
          input.tournamentId as string,
          input.name as string,
          (input.memberIds as string[]) || [],
          (input.memberNames as string[]) || [],
          input.coachName as string | undefined,
        );

      case "delete_team":
        return await deleteTeam(input.tournamentId as string, input.teamId as string);

      case "list_teams":
        return await listTeams(input.tournamentId as string);

      // ===== 워크플로우 핸들러 =====

      case "create_team_league":
        return await createTeamLeague(input, executeTool);

      case "create_individual_tournament":
        return await createIndividualTournament(input, executeTool);

      case "run_full_simulation":
        return await runFullSimulation(input, executeTool);

      default:
        return JSON.stringify({ error: `알 수 없는 도구: ${name}` });
    }
  } catch (err: unknown) {
    const e = err as { message?: string };
    return JSON.stringify({ error: e.message || "도구 실행 실패" });
  }
}

// addDays는 db-helpers.ts로 이동됨
