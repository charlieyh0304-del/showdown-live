# Sim-v2 Gap Analysis: 시뮬레이션 vs 관람 모드

## 1. scoreHistory 누락

### 현재 상태
- **시뮬레이션 (`simulation.ts:116`)**: `scoreHistory: []` — 빈 배열로 설정. 실제 득점 기록을 생성하지 않음.
- **LiveMatchView (`LiveMatchView.tsx:94`)**: `match.scoreHistory ?? []`를 `ScoreHistorySection`에 전달. 빈 배열이면 섹션 자체가 렌더링되지 않음 (`history.length === 0 return null`, line 134).

### ScoreHistoryEntry 필드 목록 (types/index.ts:268-280)
| 필드 | 타입 | 설명 |
|------|------|------|
| `time` | string | 시각 (HH:MM:SS) |
| `scoringPlayer` | string | 점수를 받는 선수/팀 이름 |
| `actionPlayer` | string | 액션한 선수 이름 |
| `actionType` | ScoreActionType | goal, irregular_serve, centerboard 등 |
| `actionLabel` | string | UI 표시 라벨 |
| `points` | number | 부여 점수 |
| `set` | number | 세트 번호 |
| `server` | string | 서브권 가진 선수 이름 |
| `serveNumber` | number | 몇 번째 서브 |
| `scoreBefore` | {player1, player2} | 득점 전 스코어 |
| `scoreAfter` | {player1, player2} | 득점 후 스코어 |

### Gap
시뮬레이션이 scoreHistory를 생성하지 않으므로, 시뮬레이션된 경기를 관람 모드에서 클릭하면 "경기 기록" 섹션이 아예 표시되지 않음. 실제 심판 모드에서 진행한 경기와의 차이가 명확함.

### 수정 필요
- **파일**: `src/shared/utils/simulation.ts`
- **변경**: `simulateSet()` 또는 별도 함수에서 각 득점 이벤트마다 `ScoreHistoryEntry`를 생성. IBSA 액션 타입(goal, irregular_serve, centerboard 등)을 랜덤하게 배분하여 현실적인 히스토리 생성.

---

## 2. 대진표 표시 (BracketTab)

### 현재 상태
- **관람 모드 BracketTab (`TournamentView.tsx:433-611`)**:
  - 개인전: `IndividualBracket` — 매트릭스(교차표) 형태. 모든 선수 vs 선수 결과를 격자로 표시. groupId로 분류하는 로직 **없음**.
  - 팀전: `TeamBracket` — 단순 리스트 형태. 모든 경기를 순서대로 나열. 조별 분류 **없음**.
- **조별 순위 표시**: 없음. `match.groupId` 필드는 타입에 존재하지만 (`Match.groupId?: string`, types:333), BracketTab에서 사용하지 않음.

### Gap
- 시뮬레이션이 `groupId`를 설정하지 않음 (라운드로빈만 생성).
- 관람 모드의 BracketTab이 `groupId`별 필터링/분류를 하지 않음.
- 조별 예선 → 본선 구조를 표시할 방법이 없음.

### 수정 필요
- **파일**: `src/shared/utils/simulation.ts`
  - 조별 리그 시뮬레이션 시 `groupId` 필드를 경기에 추가
- **파일**: `src/spectator/pages/TournamentView.tsx` (BracketTab)
  - `groupId`별로 경기를 그룹화하여 조별 대진표 표시
  - 각 조의 순위표(미니 랭킹) 표시

---

## 3. 스케줄/심판 배정

### 현재 상태
- **시뮬레이션 (`simulation.ts:84-88, 117-118`)**:
  - 심판 3명 생성하고 `refereeId`/`refereeName`을 매치에 배정함 (line 118-119).
  - **schedule 컬렉션에 데이터를 쓰지 않음** — `SimulationResult`에 schedule 필드가 없음.
  - **tournamentReferees 컬렉션에 데이터를 쓰지 않음** — `referees` 배열의 `assignedMatchIds`가 반환되지만 Firebase에 저장하는 코드가 TournamentDetail의 `handleSimulate`에 없음 (line 77-109).
- **TournamentDetail handleSimulate (`TournamentDetail.tsx:77-109`)**:
  - `addTournamentPlayer`, `setTeamsBulk`, `setMatchesBulk`, `updateTournament`만 호출.
  - `setScheduleBulk` 미호출, `assignRefereeToMatch`(useTournamentReferees) 미호출.
- **관람/심판 모드에서의 사용**:
  - `useSchedule` (`useFirebase.ts:322-346`): `schedule/{tournamentId}` 경로 구독. 관람 모드의 TournamentView에서는 **schedule을 사용하지 않음** (import도 없음).
  - `useTournamentReferees` (`useFirebase.ts:300-319`): `tournamentReferees/{tournamentId}` 경로 구독. 심판 모드에서 자신에게 배정된 경기를 찾는 데 사용될 수 있으나, 시뮬레이션이 데이터를 쓰지 않으므로 빈 상태.
  - Match 자체에 `refereeId`/`refereeName`이 있어 관람 모드(`LiveMatchView.tsx:89`)에서는 표시 가능.

### Gap
- schedule 데이터가 없어 시간표/코트 배정 정보를 관람 모드에서 볼 수 없음.
- tournamentReferees 데이터가 없어 심판 모드에서 배정된 경기 목록이 비어있음.

### 수정 필요
- **파일**: `src/shared/utils/simulation.ts`
  - `SimulationResult`에 `schedule: Omit<ScheduleSlot, 'id'>[]` 필드 추가
  - 시뮬레이션 시 courtId/courtName/scheduledTime 생성
- **파일**: `src/admin/pages/TournamentDetail.tsx` (`handleSimulate`)
  - `setScheduleBulk(result.schedule)` 호출 추가
  - `useTournamentReferees`의 `assignRefereeToMatch` 호출하여 심판 배정 데이터 저장

---

## 4. 선수 통계 (RankingTab)

### 현재 상태
- **관람 모드 IndividualRankingTable (`TournamentView.tsx:635-697`)**:
  - 표시 컬럼: 순위, 선수명, 승, 패, 세트(setsWon/setsLost), 포인트(pointsFor/pointsAgainst)
  - `PlayerRanking` 타입 (`types:405-416`): played, wins, losses, setsWon, setsLost, pointsFor, pointsAgainst, rank
- **관람 모드 TeamRankingTable (`TournamentView.tsx:699-746`)**:
  - 표시 컬럼: 순위, 팀명, 승, 패, 득점(pointsFor), 실점(pointsAgainst)
  - `TeamRanking` 타입 (`types:418-427`): played, wins, losses, pointsFor, pointsAgainst, rank

### Gap
- 세트득실, 골득실, 총포인트 등의 통계가 **이미 표시되고 있음** (개인전에서).
- 그러나 시뮬레이션 데이터의 `winnerId`가 null로 설정되는 세트가 있음 (`simulation.ts:28`: `winnerId: null`). 이는 ranking 계산에 영향을 줄 수 있음.
- 팀전에서는 세트득실이 표시되지 않음 (TeamRanking 타입에 setsWon/setsLost 없음).

### 수정 필요
- **파일**: `src/shared/utils/simulation.ts`
  - `simulateSet()`에서 `winnerId`를 실제 승자 ID로 설정 (현재 `null`)

---

## 5. 경기 상세 (완료된 경기 클릭)

### 현재 상태
- **HistoryTab (`TournamentView.tsx:763-827`)**: 완료된 경기 목록. 클릭 시 `/spectator/match/{tournamentId}/{matchId}`로 이동 → `LiveMatchView` 렌더링.
- **LiveMatchView (`LiveMatchView.tsx`)**:
  - `IndividualMatchDetail`: 세트별 점수 표시 (line 250-273). sets 데이터는 시뮬레이션이 정상 생성.
  - `ScoreHistorySection` (line 93-94): `match.scoreHistory ?? []` 사용. **scoreHistory가 빈 배열이면 "경기 기록" 섹션이 표시되지 않음** (`history.length === 0 return null`).
  - 팀전 `TeamMatchDetail` (line 279-311): 단일 세트 점수만 표시. scoreHistory 없으면 득점 과정을 볼 수 없음.

### scoreHistory 없을 때 표시 내용
1. 경기 상태 (완료/진행중/대기)
2. 선수/팀 이름
3. 세트별 점수표 (개인전) 또는 단일 점수 (팀전)
4. 경기장/심판 정보
5. **"경기 기록" 섹션은 완전히 숨겨짐** — 빈 상태 안내 메시지도 없음

### Gap
- 시뮬레이션 경기에서 경기 기록이 아예 보이지 않음.
- scoreHistory가 없을 때 "시뮬레이션 경기입니다" 등의 안내가 없음.

### 수정 필요
- **파일**: `src/shared/utils/simulation.ts`
  - 각 세트의 점수 변화를 시뮬레이션하여 ScoreHistoryEntry 배열 생성
- **파일**: `src/spectator/pages/LiveMatchView.tsx` (선택적)
  - scoreHistory가 없을 때 "경기 기록이 없습니다" 메시지 표시 (현재는 null 반환)

---

## 요약: 수정 우선순위

| 우선순위 | Gap | 수정 파일 | 영향도 |
|---------|-----|-----------|--------|
| **P0** | scoreHistory 미생성 | `simulation.ts` | 관람 모드 경기 상세에서 기록 표시 불가 |
| **P0** | winnerId: null (세트) | `simulation.ts` | 랭킹 계산 오류 가능 |
| **P1** | schedule 미생성 | `simulation.ts`, `TournamentDetail.tsx` | 스케줄 탭 빈 상태 |
| **P1** | tournamentReferees 미저장 | `TournamentDetail.tsx` | 심판 모드 배정 목록 빈 상태 |
| **P2** | groupId 미지원 | `simulation.ts`, `TournamentView.tsx` | 조별 리그 대진표 미분류 |
| **P3** | scoreHistory 없을 때 안내 | `LiveMatchView.tsx` | UX 개선 |
