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
      case "simulate_matches": {
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
        const includeThirdPlace2 = input.includeThirdPlace !== false;
        const includeFifthToEighth2 = input.includeFifthToEighth !== false;
        const includeClassification2 = input.includeClassification !== false;
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

        let wildcardCount = (input.wildcardCount as number) || (finalsConfig2?.wildcardCount as number) || 0;

        // 자동 와일드카드 추론: 조당 진출자 × 조 수가 2의 거듭제곱이 아니면 자동 보충
        const groupCount2 = gStats.size;
        const baseAdvance = advancePerGroup2 * groupCount2;
        if (wildcardCount === 0 && baseAdvance > 0) {
          const nearestPow = Math.pow(2, Math.ceil(Math.log2(baseAdvance)));
          if (nearestPow > baseAdvance) {
            wildcardCount = nearestPow - baseAdvance; // 예: 14→16, 와일드카드=2
          }
        }

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
              wildcardCandidates.push({ id: p.id, name: p.name, gid, rank: i + 1, wins: p.wins, sd: p.sd, pd: p.pd });
            } else {
              eliminated.push({ id: p.id, name: p.name, gid, rank: i + 1 });
            }
          });
        }

        // 와일드카드: 전체 조의 차순위 중 성적 상위 M명 추가 진출
        if (wildcardCount > 0 && wildcardCandidates.length > 0) {
          wildcardCandidates.sort((a, b) => b.wins - a.wins || b.sd - a.sd || b.pd - a.pd);
          const wcAdvanced = wildcardCandidates.slice(0, Math.min(wildcardCount, wildcardCandidates.length));
          const wcEliminated = wildcardCandidates.slice(Math.min(wildcardCount, wildcardCandidates.length));
          for (const wc of wcAdvanced) advanced.push({ id: wc.id, name: wc.name, gid: wc.gid, rank: wc.rank });
          for (const wc of wcEliminated) eliminated.push({ id: wc.id, name: wc.name, gid: wc.gid, rank: wc.rank });
        } else {
          // 와일드카드 없으면 후보를 전부 탈락으로
          for (const wc of wildcardCandidates) eliminated.push({ id: wc.id, name: wc.name, gid: wc.gid, rank: wc.rank });
        }

        if (advanced.length < 2) return JSON.stringify({ error: `진출자 ${advanced.length}명. 최소 2명 필요.` });

        // 브라켓 크기: 항상 진출자 수에서 가장 가까운 2의 거듭제곱
        const nearestPow2 = Math.pow(2, Math.ceil(Math.log2(Math.max(2, advanced.length))));
        const bracketSize = nearestPow2;
        const isTeamTour2 = tour2.type === "team" || tour2.type === "randomTeamLeague";

        // 교차 시드 배치 (같은 조 1라운드 대결 방지)
        const top = advanced.filter(p => p.rank === 1);
        const sec = advanced.filter(p => p.rank === 2);
        const wcPlayers = advanced.filter(p => p.rank > 2);
        // 2위 역순 배치 (A1 vs G2, B1 vs F2 형태를 위해)
        const secReversed = [...sec].reverse();
        // 시드 순서: 1위들(정순) → 2위들(역순) → 와일드카드
        const seeded = [...top, ...secReversed, ...wcPlayers];

        // 같은 조 대결 방지: fold-pairing 후 같은 조면 인접 슬롯과 스왑
        const halfBracket = Math.floor(bracketSize / 2);
        const pairIndices: [number, number][] = [];
        for (let i = 0; i < halfBracket; i++) {
          pairIndices.push([i, bracketSize - 1 - i]);
        }
        // 같은 조 충돌 검사 및 스왑
        for (let i = 0; i < pairIndices.length; i++) {
          const [idx1, idx2] = pairIndices[i];
          const p1 = idx1 < seeded.length ? seeded[idx1] : null;
          const p2 = idx2 < seeded.length ? seeded[idx2] : null;
          if (p1 && p2 && p1.gid === p2.gid) {
            // 같은 조 충돌 → 다음 페어의 p2와 스왑 시도
            for (let j = i + 1; j < pairIndices.length; j++) {
              const [, swapIdx2] = pairIndices[j];
              const swapP2 = swapIdx2 < seeded.length ? seeded[swapIdx2] : null;
              if (swapP2 && swapP2.gid !== p1.gid) {
                const origP2Gid = p2.gid;
                const swapTarget1 = pairIndices[j][0] < seeded.length ? seeded[pairIndices[j][0]] : null;
                if (!swapTarget1 || swapTarget1.gid !== origP2Gid) {
                  // 스왑 실행
                  [seeded[idx2], seeded[swapIdx2]] = [seeded[swapIdx2], seeded[idx2]];
                  break;
                }
              }
            }
          }
        }

        // 전체 브라켓 생성 (BYE 포함, 모든 라운드)
        const now2 = Date.now();
        const bulk2: Record<string, unknown> = {};
        let mc = 0;
        const summary: string[] = [];

        const ROUND_NAMES: Record<number, string> = { 32: "32강", 16: "16강", 8: "8강", 4: "4강", 2: "결승" };
        const getRoundName = (n: number) => ROUND_NAMES[n] || `${n}강`;

        // 라운드별 matchKey 추적 (승자 연결용)
        const roundMatchKeys: string[][] = [];

        // 1라운드: 모든 브라켓 슬롯 생성 (BYE 포함)
        const r1Keys: string[] = [];
        const firstRoundName = getRoundName(bracketSize);
        let r1RealCount = 0;
        const r1Summaries: string[] = [];
        for (let i = 0; i < halfBracket; i++) {
          const p1 = i < seeded.length ? seeded[i] : null;
          const p2 = (bracketSize - 1 - i) < seeded.length ? seeded[bracketSize - 1 - i] : null;
          const mKey = db.ref(`matches/${tid}`).push().key!;

          if (p1 && p2) {
            // 실제 경기
            bulk2[`matches/${tid}/${mKey}`] = {
              tournamentId: tid, type: tour2.type || "individual", status: "pending",
              round: 1, bracketPosition: i, bracketRound: firstRoundName, roundLabel: firstRoundName,
              stageId: finalsStageId2,
              player1Id: p1.id, player2Id: p2.id,
              player1Name: p1.name, player2Name: p2.name,
              ...(isTeamTour2 ? { team1Id: p1.id, team2Id: p2.id, team1Name: p1.name, team2Name: p2.name } : {}),
              sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
              currentSet: 0, player1Timeouts: 0, player2Timeouts: 0,
              winnerId: null, createdAt: now2 + mc,
            };
            r1Summaries.push(`  ${r1RealCount + 1}. ${p1.name}(${p1.gid}${p1.rank}위) vs ${p2.name}(${p2.gid}${p2.rank}위)`);
            r1RealCount++;
          } else if (p1) {
            // BYE: p1 자동 진출 (completed 경기로 생성)
            bulk2[`matches/${tid}/${mKey}`] = {
              tournamentId: tid, type: tour2.type || "individual", status: "completed",
              round: 1, bracketPosition: i, bracketRound: firstRoundName, roundLabel: firstRoundName,
              stageId: finalsStageId2, isBye: true,
              player1Id: p1.id, player2Id: "BYE",
              player1Name: p1.name, player2Name: "부전승",
              ...(isTeamTour2 ? { team1Id: p1.id, team2Id: "BYE", team1Name: p1.name, team2Name: "부전승" } : {}),
              sets: [], winnerId: p1.id, createdAt: now2 + mc,
            };
            r1Summaries.push(`  (부전승) ${p1.name}(${p1.gid}${p1.rank}위)`);
          } else if (p2) {
            // BYE: p2 자동 진출
            bulk2[`matches/${tid}/${mKey}`] = {
              tournamentId: tid, type: tour2.type || "individual", status: "completed",
              round: 1, bracketPosition: i, bracketRound: firstRoundName, roundLabel: firstRoundName,
              stageId: finalsStageId2, isBye: true,
              player1Id: "BYE", player2Id: p2.id,
              player1Name: "부전승", player2Name: p2.name,
              ...(isTeamTour2 ? { team1Id: "BYE", team2Id: p2.id, team1Name: "부전승", team2Name: p2.name } : {}),
              sets: [], winnerId: p2.id, createdAt: now2 + mc,
            };
            r1Summaries.push(`  (부전승) ${p2.name}(${p2.gid}${p2.rank}위)`);
          } else {
            // 양쪽 모두 없음 (일어나면 안 되지만 안전장치)
            bulk2[`matches/${tid}/${mKey}`] = {
              tournamentId: tid, type: tour2.type || "individual", status: "completed",
              round: 1, bracketPosition: i, bracketRound: firstRoundName, roundLabel: firstRoundName,
              stageId: finalsStageId2, isBye: true,
              player1Id: "BYE", player2Id: "BYE",
              player1Name: "부전승", player2Name: "부전승",
              sets: [], winnerId: null, createdAt: now2 + mc,
            };
          }
          r1Keys.push(mKey);
          mc++;
        }
        const byeCount = halfBracket - r1RealCount;
        summary.push(`\n[ ${firstRoundName} ] ${r1RealCount}경기${byeCount > 0 ? ` (부전승 ${byeCount})` : ""}`);
        summary.push(...r1Summaries);
        roundMatchKeys.push(r1Keys);

        // 후속 라운드: bracketSize 기반으로 정확한 라운드 수 생성
        let remainingSlots = halfBracket; // 1라운드 매치 수 (= bracketSize/2)
        let roundNum = 2;
        while (remainingSlots > 1) {
          const nextSlots = Math.floor(remainingSlots / 2);
          const rName = getRoundName(remainingSlots); // remainingSlots = 이 라운드의 참가자 수
          const rKeys: string[] = [];
          const prevRName = getRoundName(remainingSlots * 2);
          summary.push(`\n[ ${rName} ] ${nextSlots}경기`);
          for (let i = 0; i < nextSlots; i++) {
            const mKey = db.ref(`matches/${tid}`).push().key!;
            bulk2[`matches/${tid}/${mKey}`] = {
              tournamentId: tid, type: tour2.type || "individual", status: "pending",
              round: roundNum, bracketPosition: i, bracketRound: rName, roundLabel: rName,
              stageId: finalsStageId2,
              player1Id: "", player2Id: "",
              player1Name: `${prevRName} 승자${i * 2 + 1}`, player2Name: `${prevRName} 승자${i * 2 + 2}`,
              ...(isTeamTour2 ? { team1Id: "", team2Id: "", team1Name: `${prevRName} 승자${i * 2 + 1}`, team2Name: `${prevRName} 승자${i * 2 + 2}` } : {}),
              sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
              currentSet: 0, player1Timeouts: 0, player2Timeouts: 0,
              winnerId: null, createdAt: now2 + mc,
              sourceMatch1: roundMatchKeys[roundMatchKeys.length - 1][i * 2],
              sourceMatch2: roundMatchKeys[roundMatchKeys.length - 1][i * 2 + 1],
            };
            summary.push(`  ${i + 1}. ${prevRName} 승자${i * 2 + 1} vs ${prevRName} 승자${i * 2 + 2}`);
            rKeys.push(mKey);
            mc++;
          }
          roundMatchKeys.push(rKeys);
          remainingSlots = nextSlots;
          roundNum++;
        }

        // 3/4위 결정전 (bracketSize >= 4이면 4강이 존재하므로 가능)
        if (includeThirdPlace2 && bracketSize >= 4) {
          const sfKeys = roundMatchKeys[roundMatchKeys.length - 2]; // 4강 키
          const mKey = db.ref(`matches/${tid}`).push().key!;
          bulk2[`matches/${tid}/${mKey}`] = {
            tournamentId: tid, type: tour2.type || "individual", status: "pending",
            round: roundNum, bracketRound: "3/4위", roundLabel: "3/4위 결정전", stageId: `${finalsStageId2}_3rd`,
            player1Id: "", player2Id: "", player1Name: "4강 패자1", player2Name: "4강 패자2",
            ...(isTeamTour2 ? { team1Id: "", team2Id: "", team1Name: "4강 패자1", team2Name: "4강 패자2" } : {}),
            sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
            currentSet: 0, player1Timeouts: 0, player2Timeouts: 0,
            winnerId: null, createdAt: now2 + mc,
            sourceMatch1: sfKeys?.[0], sourceMatch2: sfKeys?.[1], sourceType: "loser",
          };
          summary.push("\n[ 3/4위 결정전 ] 1경기");
          mc++;
        }

        // 5-8위, 9-16위는 run_full_simulation에서 브라켓 시뮬 완료 후 직접 생성
        // (여기서 sourceMatch 방식으로 사전 생성하면 run_full_simulation과 중복됨)

        // 순위 결정전: 그룹 예선 탈락자를 티어별로 분류 (17위~)
        // rankingUpTo > 0이면 해당 순위까지만 순위 결정전 진행
        const doRanking = rankingUpTo > 0 || includeFifthToEighth2 || includeClassification2;
        if (doRanking && eliminated.length >= 2) {
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
            } else if (includeClassification2) {
              // classificationGroups:true일 때만 그룹 탈락자 순위결정전 생성
              // (fifthToEighth만 true이면 5-8위는 run_full_simulation에서 처리)
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
          rankingSetsToWin: input.rankingSetsToWin, rankingWinScore: input.rankingWinScore,
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
          ...(input.scheduleDates ? { scheduleDates: input.scheduleDates } : {}),
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
