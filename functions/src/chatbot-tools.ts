import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { db } from "./db-helpers";
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
        return await addReferee(input.name as string, input.role as string | undefined);

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
          rankingSetsToWin: input.rankingSetsToWin, rankingWinScore: input.rankingWinScore,
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
          ...(input.scheduleDates ? { scheduleDates: input.scheduleDates } : {}),
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

        // 1. 리그/예선 시뮬레이션 (결승 자동 생성 비활성화 — run_full_simulation이 직접 처리)
        const simResult = await executeTool("simulate_matches", { tournamentId: tid, skipAutoGenerate: true, lightweight: true });
        const simParsed = JSON.parse(simResult);
        if (!simParsed.success && simParsed.count !== 0) return JSON.stringify({ error: `${simIsFullLeague ? "리그" : "예선"} 시뮬레이션 실패: ${simParsed.error}` });
        allSteps.push(`${simIsFullLeague ? "리그" : "예선"} ${simParsed.count}경기 완료`);

        // 2. 결승 생성 + 시뮬레이션 (풀리그 제외)
        if (!simIsFullLeague) {
          // 결승이 없으면 생성
          const mSnap = await db.ref(`matches/${tid}`).once("value");
          const allM = mSnap.exists() ? Object.values(mSnap.val() as Record<string, Record<string, unknown>>) : [];
          const hasFinals = allM.some(m => ((m.stageId as string) || "").includes("finals") || ((m.stageId as string) || "").includes("ranking"));

          if (!hasFinals) {
            const fc = tourData.finalsConfig as Record<string, unknown> | undefined;
            const rc = tourData.rankingMatchConfig as Record<string, unknown> | undefined;
            const genR = await executeTool("generate_finals", {
              tournamentId: tid,
              advancePerGroup: (fc?.advancePerGroup as number) || 2,
              wildcardCount: (fc?.wildcardCount as number) || 0,
              includeThirdPlace: rc?.thirdPlace !== false,
              includeFifthToEighth: rc?.fifthToEighth || false,
              includeClassification: rc?.classificationGroups || false,
            });
            const genP = JSON.parse(genR);
            if (genP.success) {
              allSteps.push(`본선 ${genP.matchCount}경기 생성 (${genP.structure || ""})`);
            } else {
              allSteps.push(`본선 생성 오류: ${genP.error || "unknown"}`);
            }
          } else {
            allSteps.push("본선 이미 존재");
          }

          // 본선 + 분류 경기 반복 시뮬레이션 (hasFinals 여부와 무관하게 항상 실행)
          let consecutiveZero = 0;
          for (let round = 0; round < 12; round++) {
            const finSim = await executeTool("simulate_matches", { tournamentId: tid, skipAutoGenerate: true, lightweight: true });
            const finP = JSON.parse(finSim);
            if (finP.success && finP.count > 0) {
              allSteps.push(`라운드${round + 1}: ${finP.count}경기 완료`);
              consecutiveZero = 0;
            } else if (finP.success) {
              consecutiveZero++;
              if (consecutiveZero >= 2) break;
            } else {
              consecutiveZero++;
              if (consecutiveZero >= 2) break;
            }
          }
        }

        // 2.5 브라켓 패자 기반 순위결정전 생성 + 시뮬레이션 (배치 처리)
        const mType = isTeam ? "team" : "individual";
        const nowElim = Date.now();
        const createElimRankingMatches = async (
          groups: Array<{ label: string; startRank: number; members: Array<{ id: string; name: string }> }>,
          baseStageId: string,
          timeOffset: number,
        ) => {
          // 1단계: 모든 그룹의 준결승/단일경기 한 번에 생성
          const allBulk: Record<string, unknown> = {};
          const semiKeyMap: Map<string, { semi1: string; semi2: string }> = new Map();
          let totalMc = 0;
          for (const grp of groups) {
            const members = grp.members;
            if (members.length < 2) continue;
            const stageId3 = `${baseStageId}_${grp.startRank}`;
            if (members.length >= 4) {
              const semi1Key = db.ref(`matches/${tid}`).push().key!;
              allBulk[`matches/${tid}/${semi1Key}`] = {
                tournamentId: tid, type: mType, status: "pending", round: 1, stageId: stageId3,
                bracketRound: `${grp.label} 결정전`, roundLabel: `${grp.label} 결정전`,
                player1Id: members[0].id, player2Id: members[3].id,
                player1Name: members[0].name, player2Name: members[3].name,
                ...(isTeam ? { team1Id: members[0].id, team2Id: members[3].id, team1Name: members[0].name, team2Name: members[3].name } : {}),
                sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
                currentSet: 0, player1Timeouts: 0, player2Timeouts: 0, winnerId: null, createdAt: nowElim + timeOffset + totalMc,
              };
              totalMc++;
              const semi2Key = db.ref(`matches/${tid}`).push().key!;
              allBulk[`matches/${tid}/${semi2Key}`] = {
                tournamentId: tid, type: mType, status: "pending", round: 1, stageId: stageId3,
                bracketRound: `${grp.label} 결정전`, roundLabel: `${grp.label} 결정전`,
                player1Id: members[1].id, player2Id: members[2].id,
                player1Name: members[1].name, player2Name: members[2].name,
                ...(isTeam ? { team1Id: members[1].id, team2Id: members[2].id, team1Name: members[1].name, team2Name: members[2].name } : {}),
                sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
                currentSet: 0, player1Timeouts: 0, player2Timeouts: 0, winnerId: null, createdAt: nowElim + timeOffset + totalMc,
              };
              totalMc++;
              semiKeyMap.set(stageId3, { semi1: semi1Key, semi2: semi2Key });
            } else {
              // 2-3명: 단순 1경기
              const mKey = db.ref(`matches/${tid}`).push().key!;
              allBulk[`matches/${tid}/${mKey}`] = {
                tournamentId: tid, type: mType, status: "pending", round: 1, stageId: stageId3,
                bracketRound: `${grp.label} 결정전`, roundLabel: `${grp.startRank}/${grp.startRank + 1}위 결정전`,
                player1Id: members[0].id, player2Id: members[1].id,
                player1Name: members[0].name, player2Name: members[1].name,
                ...(isTeam ? { team1Id: members[0].id, team2Id: members[1].id, team1Name: members[0].name, team2Name: members[1].name } : {}),
                sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
                currentSet: 0, player1Timeouts: 0, player2Timeouts: 0, winnerId: null, createdAt: nowElim + timeOffset + totalMc,
              };
              totalMc++;
            }
          }
          if (totalMc === 0) return;
          await db.ref().update(allBulk);
          // 준결승 1회 시뮬레이션
          await executeTool("simulate_matches", { tournamentId: tid, skipAutoGenerate: true, lightweight: true });

          // 2단계: 모든 그룹의 결승(승자전+패자전) 한 번에 생성
          if (semiKeyMap.size > 0) {
            const refreshSnap = await db.ref(`matches/${tid}`).once("value");
            const allM = refreshSnap.val() as Record<string, Record<string, unknown>>;
            const finalsBulk: Record<string, unknown> = {};
            let finalsMc = 0;
            for (const grp of groups) {
              if (grp.members.length < 4) continue;
              const stageId3 = `${baseStageId}_${grp.startRank}`;
              const keys = semiKeyMap.get(stageId3);
              if (!keys) continue;
              const sm1 = allM[keys.semi1], sm2 = allM[keys.semi2];
              if (!sm1 || !sm2 || sm1.status !== "completed" || sm2.status !== "completed") continue;

              const extractWL = (sm: Record<string, unknown>) => {
                const wId = sm.winnerId as string;
                const p1 = (sm.player1Id || sm.team1Id) as string;
                const wName = wId === p1 ? (sm.player1Name || sm.team1Name) as string : (sm.player2Name || sm.team2Name) as string;
                const lId = wId === p1 ? (sm.player2Id || sm.team2Id) as string : p1;
                const lName = wId === p1 ? (sm.player2Name || sm.team2Name) as string : (sm.player1Name || sm.team1Name) as string;
                return { wId, wName, lId, lName };
              };
              const w1 = extractWL(sm1), w2 = extractWL(sm2);

              const wKey = db.ref(`matches/${tid}`).push().key!;
              finalsBulk[`matches/${tid}/${wKey}`] = {
                tournamentId: tid, type: mType, status: "pending", round: 2, stageId: stageId3,
                bracketRound: `${grp.startRank}/${grp.startRank + 1}위`, roundLabel: `${grp.startRank}/${grp.startRank + 1}위 결정전`,
                player1Id: w1.wId, player2Id: w2.wId,
                player1Name: w1.wName, player2Name: w2.wName,
                ...(isTeam ? { team1Id: w1.wId, team2Id: w2.wId, team1Name: w1.wName, team2Name: w2.wName } : {}),
                sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
                currentSet: 0, player1Timeouts: 0, player2Timeouts: 0, winnerId: null, createdAt: nowElim + timeOffset + 1000 + finalsMc,
              };
              finalsMc++;
              const lKey = db.ref(`matches/${tid}`).push().key!;
              finalsBulk[`matches/${tid}/${lKey}`] = {
                tournamentId: tid, type: mType, status: "pending", round: 2, stageId: stageId3,
                bracketRound: `${grp.startRank + 2}/${grp.startRank + 3}위`, roundLabel: `${grp.startRank + 2}/${grp.startRank + 3}위 결정전`,
                player1Id: w1.lId, player2Id: w2.lId,
                player1Name: w1.lName, player2Name: w2.lName,
                ...(isTeam ? { team1Id: w1.lId, team2Id: w2.lId, team1Name: w1.lName, team2Name: w2.lName } : {}),
                sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
                currentSet: 0, player1Timeouts: 0, player2Timeouts: 0, winnerId: null, createdAt: nowElim + timeOffset + 1000 + finalsMc,
              };
              finalsMc++;
            }
            if (finalsMc > 0) {
              await db.ref().update(finalsBulk);
              await executeTool("simulate_matches", { tournamentId: tid, skipAutoGenerate: true, lightweight: true });
            }
          }
          allSteps.push(`${groups.length}개 순위결정전 그룹: ${totalMc}경기 완료`);
        };

        if (!simIsFullLeague) {
          const rankSnap = await db.ref(`matches/${tid}`).once("value");
          if (rankSnap.exists()) {
            const allRankM = Object.entries(rankSnap.val() as Record<string, Record<string, unknown>>);
            const completedFinals = allRankM.filter(([, m]) =>
              m.status === "completed" && !m.isBye &&
              ((m.stageId as string) || "").includes("finals") &&
              !((m.stageId as string) || "").includes("class") &&
              !((m.stageId as string) || "").includes("3rd") &&
              !((m.stageId as string) || "").includes("5to8")
            );

            // 라운드별 패자 수집
            const roundLosers = new Map<string, Array<{ id: string; name: string }>>();
            for (const [, m] of completedFinals) {
              const rl = (m.roundLabel || m.bracketRound || "") as string;
              if (!rl || rl === "결승") continue;
              if (!roundLosers.has(rl)) roundLosers.set(rl, []);
              const wId = m.winnerId as string;
              const p1Id = (m.player1Id || m.team1Id) as string;
              const p2Id = (m.player2Id || m.team2Id) as string;
              const loserId = wId === p1Id ? p2Id : p1Id;
              const loserName = wId === p1Id
                ? (m.player2Name || m.team2Name) as string
                : (m.player1Name || m.team1Name) as string;
              if (loserId && loserId !== "BYE" && loserName && loserName !== "부전승") {
                roundLosers.get(rl)!.push({ id: loserId, name: loserName });
              }
            }

            const finalsStageId = (tourData.stages as Array<{ id: string; type: string }>)?.find(s => s.type === "finals")?.id || "finals";
            // nowElim/mType 사용 (상위 스코프)

            // 5-8위 결정전: 8강 패자 4명
            const qfLosers = roundLosers.get("8강") || [];
            if (qfLosers.length >= 2) {
              const rankBulk: Record<string, unknown> = {};
              let rmc = 0;
              // 4명이면 풀 방식 (2 준결승 + 5/6위 + 7/8위), 2-3명이면 라운드로빈
              if (qfLosers.length >= 4) {
                // 준결승 2경기
                for (let qi = 0; qi < 2; qi++) {
                  const p1 = qfLosers[qi], p2 = qfLosers[3 - qi];
                  const mKey = db.ref(`matches/${tid}`).push().key!;
                  rankBulk[`matches/${tid}/${mKey}`] = {
                    tournamentId: tid, type: mType, status: "pending",
                    round: 1, stageId: `${finalsStageId}_class_5to8`,
                    bracketRound: "5-8위", roundLabel: "5-8위 결정전",
                    player1Id: p1.id, player2Id: p2.id,
                    player1Name: p1.name, player2Name: p2.name,
                    ...(isTeam ? { team1Id: p1.id, team2Id: p2.id, team1Name: p1.name, team2Name: p2.name } : {}),
                    sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
                    currentSet: 0, player1Timeouts: 0, player2Timeouts: 0,
                    winnerId: null, createdAt: nowElim + rmc,
                  };
                  rmc++;
                }
              } else {
                // 라운드로빈
                for (let i = 0; i < qfLosers.length; i++) {
                  for (let j = i + 1; j < qfLosers.length; j++) {
                    const mKey = db.ref(`matches/${tid}`).push().key!;
                    rankBulk[`matches/${tid}/${mKey}`] = {
                      tournamentId: tid, type: mType, status: "pending",
                      round: 1, stageId: `${finalsStageId}_class_5to8`,
                      bracketRound: "5~8위 순위 결정전", roundLabel: "5~8위 순위 결정전",
                      player1Id: qfLosers[i].id, player2Id: qfLosers[j].id,
                      player1Name: qfLosers[i].name, player2Name: qfLosers[j].name,
                      ...(isTeam ? { team1Id: qfLosers[i].id, team2Id: qfLosers[j].id, team1Name: qfLosers[i].name, team2Name: qfLosers[j].name } : {}),
                      sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
                      currentSet: 0, player1Timeouts: 0, player2Timeouts: 0,
                      winnerId: null, createdAt: nowElim + rmc,
                    };
                    rmc++;
                  }
                }
              }
              if (rmc > 0) {
                await db.ref().update(rankBulk);
                allSteps.push(`5-8위 결정전 ${rmc}경기 생성`);
                // 시뮬레이션 (준결승 → 5/6위, 7/8위)
                for (let r = 0; r < 3; r++) {
                  const rs = await executeTool("simulate_matches", { tournamentId: tid, skipAutoGenerate: true, lightweight: true });
                  const rp = JSON.parse(rs);
                  if (rp.success && rp.count > 0) {
                    allSteps.push(`5-8위 라운드${r + 1}: ${rp.count}경기 완료`);
                    // 풀 방식: 준결승 후 5/6위, 7/8위 매치 생성
                    if (qfLosers.length >= 4 && r === 0) {
                      const refreshSnap2 = await db.ref(`matches/${tid}`).once("value");
                      const allM2 = refreshSnap2.val() as Record<string, Record<string, unknown>>;
                      const semiMatches = Object.entries(allM2).filter(([, m2]) =>
                        m2.status === "completed" && (m2.roundLabel as string) === "5-8위 결정전" &&
                        ((m2.stageId as string) || "").includes("5to8")
                      );
                      if (semiMatches.length >= 2) {
                        const winners: Array<{ id: string; name: string }> = [];
                        const losers2: Array<{ id: string; name: string }> = [];
                        for (const [, sm] of semiMatches) {
                          const wId2 = sm.winnerId as string;
                          const p1Id2 = (sm.player1Id || sm.team1Id) as string;
                          const wName2 = wId2 === p1Id2 ? (sm.player1Name || sm.team1Name) as string : (sm.player2Name || sm.team2Name) as string;
                          const lId2 = wId2 === p1Id2 ? (sm.player2Id || sm.team2Id) as string : p1Id2;
                          const lName2 = wId2 === p1Id2 ? (sm.player2Name || sm.team2Name) as string : (sm.player1Name || sm.team1Name) as string;
                          winners.push({ id: wId2, name: wName2 });
                          losers2.push({ id: lId2, name: lName2 });
                        }
                        const finalBulk: Record<string, unknown> = {};
                        // 5/6위전
                        const k56 = db.ref(`matches/${tid}`).push().key!;
                        finalBulk[`matches/${tid}/${k56}`] = {
                          tournamentId: tid, type: mType, status: "pending",
                          round: 2, stageId: `${finalsStageId}_class_5to8`,
                          bracketRound: "5/6위", roundLabel: "5/6위 결정전",
                          player1Id: winners[0].id, player2Id: winners[1].id,
                          player1Name: winners[0].name, player2Name: winners[1].name,
                          ...(isTeam ? { team1Id: winners[0].id, team2Id: winners[1].id, team1Name: winners[0].name, team2Name: winners[1].name } : {}),
                          sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
                          currentSet: 0, player1Timeouts: 0, player2Timeouts: 0,
                          winnerId: null, createdAt: nowElim + 100,
                        };
                        // 7/8위전
                        const k78 = db.ref(`matches/${tid}`).push().key!;
                        finalBulk[`matches/${tid}/${k78}`] = {
                          tournamentId: tid, type: mType, status: "pending",
                          round: 2, stageId: `${finalsStageId}_class_5to8`,
                          bracketRound: "7/8위", roundLabel: "7/8위 결정전",
                          player1Id: losers2[0].id, player2Id: losers2[1].id,
                          player1Name: losers2[0].name, player2Name: losers2[1].name,
                          ...(isTeam ? { team1Id: losers2[0].id, team2Id: losers2[1].id, team1Name: losers2[0].name, team2Name: losers2[1].name } : {}),
                          sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
                          currentSet: 0, player1Timeouts: 0, player2Timeouts: 0,
                          winnerId: null, createdAt: nowElim + 101,
                        };
                        await db.ref().update(finalBulk);
                      }
                    }
                  } else break;
                }
              }
            }

            // 9-16위 순위 결정전: classificationGroups가 true일 때만 실행
            const rankCfgCheck = tourData.rankingMatchConfig as Record<string, unknown> | undefined;
            const r16Losers = roundLosers.get("16강") || roundLosers.get("32강") || [];
            if (rankCfgCheck?.classificationGroups && r16Losers.length >= 2) {
              // 4명씩 그룹 분할
              const r16Groups: Array<{ label: string; startRank: number; members: typeof r16Losers }> = [];
              let r16Remaining = [...r16Losers];
              let r16RankStart = 9; // 16강 패자 = 9위~
              while (r16Remaining.length >= 2) {
                const grpSize = Math.min(4, r16Remaining.length);
                const grpMembers = r16Remaining.slice(0, grpSize);
                const endRank = r16RankStart + grpSize - 1;
                r16Groups.push({ label: `${r16RankStart}~${endRank}위`, startRank: r16RankStart, members: grpMembers });
                r16Remaining = r16Remaining.slice(grpSize);
                r16RankStart = endRank + 1;
              }
              await createElimRankingMatches(r16Groups, `${finalsStageId}_class_9to16`, 200);
            }

            // 남은 미완료 경기 시뮬레이션 (5/6위, 7/8위 등)
            for (let extra = 0; extra < 3; extra++) {
              const extraSim = await executeTool("simulate_matches", { tournamentId: tid, skipAutoGenerate: true, lightweight: true });
              const extraP = JSON.parse(extraSim);
              if (extraP.success && extraP.count > 0) {
                allSteps.push(`추가 순위결정: ${extraP.count}경기 완료`);
              } else break;
            }

            // ===== Phase 2f: 17위~ 그룹 탈락자 순위결정전 직접 생성 =====
            // generate_finals의 classification 매치에 의존하지 않고 직접 생성
            const rankCfg = tourData.rankingMatchConfig as Record<string, unknown> | undefined;
            const doClassification = rankCfg?.classificationGroups;
            if (doClassification) {
              // 조별 순위에서 본선 미진출자(탈락자) 수집
              const qualSnap2 = await db.ref(`matches/${tid}`).once("value");
              if (qualSnap2.exists()) {
                const allQualM = Object.entries(qualSnap2.val() as Record<string, Record<string, unknown>>);

                // 예선 경기에서 조별 순위 계산
                const gRankStats = new Map<string, Array<{ id: string; name: string; wins: number; sd: number; pd: number }>>();
                for (const [, qm] of allQualM) {
                  if (qm.status !== "completed") continue;
                  const qSid = (qm.stageId as string) || "";
                  if (qSid.includes("finals") || qSid.includes("ranking") || qSid.includes("class") || qSid.includes("3rd") || qSid.includes("5to8")) continue;
                  const qGid = (qm.groupId as string) || "";
                  if (!qGid) continue;
                  if (!gRankStats.has(qGid)) gRankStats.set(qGid, []);
                  const gArr = gRankStats.get(qGid)!;
                  const qp1 = (qm.player1Id || qm.team1Id) as string;
                  const qp2 = (qm.player2Id || qm.team2Id) as string;
                  const qn1 = (qm.player1Name || qm.team1Name) as string;
                  const qn2 = (qm.player2Name || qm.team2Name) as string;
                  let e1 = gArr.find(e => e.id === qp1);
                  let e2 = gArr.find(e => e.id === qp2);
                  if (!e1) { e1 = { id: qp1, name: qn1, wins: 0, sd: 0, pd: 0 }; gArr.push(e1); }
                  if (!e2) { e2 = { id: qp2, name: qn2, wins: 0, sd: 0, pd: 0 }; gArr.push(e2); }
                  if (qm.winnerId === qp1) e1.wins++; else if (qm.winnerId === qp2) e2.wins++;
                  for (const qs of ((qm.sets || []) as Array<{ player1Score: number; player2Score: number }>)) {
                    if (qs.player1Score > qs.player2Score) { e1.sd++; e2.sd--; } else if (qs.player2Score > qs.player1Score) { e2.sd++; e1.sd--; }
                    e1.pd += qs.player1Score - qs.player2Score; e2.pd += qs.player2Score - qs.player1Score;
                  }
                }

                // 본선 진출자 ID 수집
                const advancedIds2 = new Set<string>();
                for (const [, fm] of allQualM) {
                  const fSid = (fm.stageId as string) || "";
                  if (!fSid.includes("finals") || fSid.includes("class") || fSid.includes("3rd") || fSid.includes("5to8")) continue;
                  const fp1 = (fm.player1Id || fm.team1Id) as string;
                  const fp2 = (fm.player2Id || fm.team2Id) as string;
                  if (fp1 && fp1 !== "" && fp1 !== "BYE") advancedIds2.add(fp1);
                  if (fp2 && fp2 !== "" && fp2 !== "BYE") advancedIds2.add(fp2);
                }

                // 그룹 탈락자 수집 (성적순 정렬)
                const groupEliminated: Array<{ id: string; name: string; wins: number; sd: number; pd: number }> = [];
                for (const [, gArr] of [...gRankStats.entries()].sort()) {
                  const sorted = [...gArr].sort((a, b) => b.wins - a.wins || b.sd - a.sd || b.pd - a.pd);
                  for (const p of sorted) {
                    if (!advancedIds2.has(p.id)) groupEliminated.push(p);
                  }
                }

                // 이미 classification 매치가 있는지 확인
                const existingClass = allQualM.some(([, cm]) =>
                  ((cm.stageId as string) || "").includes("class") && !((cm.stageId as string) || "").includes("5to8") && !((cm.stageId as string) || "").includes("9to16")
                );

                if (groupEliminated.length >= 2 && !existingClass) {
                  const classStageId = (tourData.stages as Array<{ id: string; type: string }>)?.find(s => s.type === "finals")?.id || "finals";

                  // 4명씩 그룹 분할 (IBSA 방식)
                  const classGroups: Array<{ label: string; startRank: number; members: Array<{ id: string; name: string }> }> = [];
                  let remaining2 = [...groupEliminated];
                  // 17위부터 (본선 16명 + 5-8위 + 9-16위 = 16)
                  let tierStart2 = 17;
                  while (remaining2.length >= 2) {
                    const grpSize = Math.min(4, remaining2.length);
                    const grpMembers = remaining2.slice(0, grpSize);
                    const endRank = tierStart2 + grpSize - 1;
                    classGroups.push({ label: `${tierStart2}~${endRank}위`, startRank: tierStart2, members: grpMembers });
                    remaining2 = remaining2.slice(grpSize);
                    tierStart2 = endRank + 1;
                  }

                  await createElimRankingMatches(classGroups, `${classStageId}_class`, 500);
                }
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

        // 5. 본선 + 순위결정전 결과 (BYE 제외)
        const finalsResults = finalM
          .filter(([, m]) => m.status === "completed" && !m.isBye && ((m.stageId as string) || "").match(/finals|ranking|3rd|5to8|class/))
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

        // 7. 최종 전체 순위 산출 (프론트엔드 calculateIndividualRanking과 동일: 전체 경기 포함)
        const finalRanking: string[] = [];
        // BYE 경기 제외, 모든 완료된 경기로 통합 순위 계산 (프론트엔드와 동일)
        const nonByeCompleted = finalM.filter(([, m]) => m.status === "completed" && !m.isBye);
        const allPlayerStats = new Map<string, { name: string; wins: number; losses: number; setsWon: number; setsLost: number; pf: number; pa: number }>();
        for (const [, m] of nonByeCompleted) {
          const id1 = (m.player1Id || m.team1Id) as string;
          const id2 = (m.player2Id || m.team2Id) as string;
          const n1 = (m.player1Name || m.team1Name) as string;
          const n2 = (m.player2Name || m.team2Name) as string;
          if (!id1 || !id2 || id1 === "BYE" || id2 === "BYE") continue;
          if (!allPlayerStats.has(id1)) allPlayerStats.set(id1, { name: n1, wins: 0, losses: 0, setsWon: 0, setsLost: 0, pf: 0, pa: 0 });
          if (!allPlayerStats.has(id2)) allPlayerStats.set(id2, { name: n2, wins: 0, losses: 0, setsWon: 0, setsLost: 0, pf: 0, pa: 0 });
          const s1 = allPlayerStats.get(id1)!, s2 = allPlayerStats.get(id2)!;
          if (m.winnerId === id1) { s1.wins++; s2.losses++; }
          else if (m.winnerId === id2) { s2.wins++; s1.losses++; }
          for (const s of ((m.sets || []) as Array<{ player1Score: number; player2Score: number }>)) {
            if (s.player1Score > s.player2Score) { s1.setsWon++; s2.setsLost++; }
            else if (s.player2Score > s.player1Score) { s2.setsWon++; s1.setsLost++; }
            s1.pf += s.player1Score; s1.pa += s.player2Score;
            s2.pf += s.player2Score; s2.pa += s.player1Score;
          }
        }
        // 승수→세트득실→점수득실 순으로 정렬 (프론트엔드와 동일)
        const sortedPlayers = [...allPlayerStats.values()].sort((a, b) => {
          if (b.wins !== a.wins) return b.wins - a.wins;
          const aSD = a.setsWon - a.setsLost, bSD = b.setsWon - b.setsLost;
          if (bSD !== aSD) return bSD - aSD;
          return (b.pf - b.pa) - (a.pf - a.pa);
        });
        // 순위 표시 범위: 대회 설정에 따라 제한
        const rkCfg = tourData.rankingMatchConfig as Record<string, unknown> | undefined;
        let maxRankDisplay = 4; // 기본: 결승까지 (1-4위)
        if (rkCfg?.fifthToEighth) maxRankDisplay = 8;
        if (rkCfg?.classificationGroups) maxRankDisplay = sortedPlayers.length; // 전체
        if (rkCfg?.rankingUpTo) maxRankDisplay = rkCfg.rankingUpTo as number;
        const displayCount = Math.min(maxRankDisplay, sortedPlayers.length);
        for (let i = 0; i < displayCount; i++) {
          const p = sortedPlayers[i];
          finalRanking.push(`${i + 1}위: ${p.name} (${p.wins}승 ${p.losses}패, 세트 ${p.setsWon}-${p.setsLost})`);
        }

        return JSON.stringify({
          success: true, steps: allSteps, groupRankings, finalsResults, teamRoster,
          finalRanking: finalRanking.join("\n"),
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

// addDays는 db-helpers.ts로 이동됨
