# Showdown Live — 외부 감사 사용자 테스트 체크리스트

> 전체 23개 페이지, 3개 모드(Admin / Referee / Spectator) 기능·접근성·스크린리더 점검  
> 각 항목: ✅ 통과 / ❌ 실패 / ⏭️ 해당 없음 으로 기록

---

## 0. 공통 (Cross-cutting)

### 0-1. 네비게이션 & 라우팅
- [ ] `/` 홈에서 관리자·심판·관람 모드 버튼 3개 표시
- [ ] 각 모드 버튼 클릭 시 올바른 경로로 이동
- [ ] 존재하지 않는 경로 → `/` 리다이렉트
- [ ] 브라우저 뒤로가기/앞으로가기 정상 동작
- [ ] 모든 페이지 새로고침 시 현재 페이지 유지 (404.html fallback)

### 0-2. 접근성 공통
- [ ] 모든 페이지 Axe WCAG 2.1 AA 위반 0건
- [ ] 키보드만으로 모든 기능 조작 가능 (Tab / Enter / Space / Esc / Arrow)
- [ ] 포커스 순서가 시각적 순서와 일치
- [ ] 모달 열림 시 포커스 트랩 동작, 닫힘 시 원래 위치 복귀
- [ ] 로딩 상태에서 `role="status"` + `aria-live="polite"` 안내
- [ ] 에러 메시지에 `role="alert"` 사용

### 0-3. 스크린리더 (NVDA / VoiceOver)
- [ ] 각 페이지 진입 시 페이지 제목(h1) 자동 읽기
- [ ] 버튼·링크·입력의 aria-label이 의미 전달
- [ ] 탭 전환 시 `aria-selected` 변경 안내
- [ ] 실시간 점수 변경 시 `aria-live` 영역 자동 읽기
- [ ] 토스트/알림 메시지 스크린리더 전달

### 0-4. 다국어 (i18n)
- [ ] 한국어(ko) 기본 표시, 하드코딩 문자열 없음
- [ ] 영어(en) 전환 시 모든 텍스트 번역 표시
- [ ] aria-label도 언어 전환 시 번역됨

---

## 1. Admin 모드

### 1-1. 관리자 로그인 (`/admin`)
- [ ] PIN 설정 화면 (첫 사용): 4자리 PIN 입력 → 확인 → 대시보드 진입
- [ ] PIN 로그인: 올바른 PIN → 대시보드 진입
- [ ] 잘못된 PIN → 에러 메시지 표시 (`role="alert"`)
- [ ] PIN 5회 실패 → 30초 잠금, 카운트다운 표시
- [ ] PIN 입력 필드에 포커스 자동 이동

### 1-2. 대시보드 (`/admin` — 인증 후)
- [ ] 대회 목록 표시 (그룹별 정렬)
- [ ] 대회별 상태 뱃지 (draft / registration / in_progress / paused / completed)
- [ ] 대회별 유형 뱃지 (individual / team / randomTeamLeague)
- [ ] "새 대회 만들기" 버튼 클릭 → `/admin/tournament/new`
- [ ] 대회 항목 클릭 → `/admin/tournament/:id`
- [ ] 대회 삭제 버튼 → 확인 모달
  - [ ] 모달 열림 시 포커스 트랩
  - [ ] PIN 입력 → 삭제 성공
  - [ ] 잘못된 PIN → 에러
  - [ ] 취소 → 모달 닫힘, 포커스 복귀
- [ ] 대회 목록 `aria-label="admin.home.tournamentListLabel"`
- [ ] 빈 상태 메시지 표시 (대회 0건일 때)

### 1-3. 대회 생성 마법사 (`/admin/tournament/new`)
#### Step 1: 기본 정보
- [ ] 대회 이름 입력
- [ ] 유형 선택 (개인전 / 팀전 / 랜덤팀리그)
- [ ] 설정 방식 선택: 프리셋(풀리그 등) 또는 직접 설정
- [ ] 프리셋 선택 시 → 적절한 단계로 자동 이동
- [ ] 직접 설정 클릭 → Step 2로 이동

#### Step 2: 참가자 수
- [ ] 참가자 수 (또는 팀 수) 입력
- [ ] 대회 모드 선택
- [ ] 팀전일 때 팀 사이즈 설정

#### Step 3: 포맷 & 채점 규칙
- [ ] 예선/본선 포맷 설정
- [ ] 채점 규칙 설정

#### Step 4: 미리보기 & 제출
- [ ] 전체 설정 요약 미리보기
- [ ] "대회 생성" 버튼 → 대회 생성 → 대시보드 복귀
- [ ] 생성 실패 시 에러 표시

#### 공통 마법사 네비게이션
- [ ] "이전 단계" 버튼으로 이전 스텝 복귀 (입력값 유지)
- [ ] "다음 단계" 버튼으로 다음 스텝 이동
- [ ] "취소" 버튼 → `/admin` 복귀
- [ ] 스텝 인디케이터에 현재 위치 표시

### 1-4. 대회 상세 (`/admin/tournament/:id`)
#### 탭 공통
- [ ] 5개 탭 (선수 | 대진표 | 일정 | 상태 | 순위)
- [ ] `role="tablist"` + `role="tab"` + `aria-selected`
- [ ] 키보드 화살표로 탭 전환
- [ ] 뒤로가기 버튼 → 대시보드 복귀

#### 시뮬레이션
- [ ] 참가자 수 입력
- [ ] autoBracket / autoReferee / autoCourt 체크박스
- [ ] 시뮬레이션 실행 → `role="status"` + `aria-live="polite"` 진행 안내
- [ ] 시뮬레이션 결과 표시

#### 선수 탭
- [ ] 선수 목록 표시
- [ ] 개별 선수 편집/삭제
- [ ] 벌크 선택(전체 선택 체크박스) + 벌크 삭제

#### 대진표 탭
- [ ] 대진표 렌더링
- [ ] 매치 상태 표시

#### 일정 탭
- [ ] 경기 일정 목록
- [ ] 심판/코트 배정 표시

#### 상태 탭
- [ ] 대회 상태 변경 (draft → registration → in_progress 등)

#### 순위 탭
- [ ] 순위 테이블 표시
- [ ] 정렬 동작

### 1-5. 선수 관리 (`/admin/players`)
- [ ] 선수 목록 표시 (`aria-label="admin.players.playerListLabel"`)
- [ ] "선수 추가" 버튼 → 모달
  - [ ] 이름 입력 (`aria-label="admin.players.playerNameAriaLabel"`)
  - [ ] 클럽 입력 (`aria-label="admin.players.clubAriaLabel"`)
  - [ ] 클래스 선택 (`aria-label="admin.players.classAriaLabel"`)
  - [ ] 성별 토글 (`aria-pressed` 상태 변화)
  - [ ] 저장 → 목록에 추가
  - [ ] 취소 → 모달 닫힘
- [ ] 선수 편집 → 모달 (기존 데이터 로드)
- [ ] 선수 삭제 → 확인 후 삭제
- [ ] 전체 선택 체크박스 → 벌크 삭제
- [ ] 빈 상태 메시지 (선수 0명)

### 1-6. 심판 관리 (`/admin/referees`)
- [ ] 심판 목록 표시
- [ ] "심판 추가" → 모달
  - [ ] 이름 (`aria-label="admin.referees.refereeNameAriaLabel"`)
  - [ ] 역할 (`aria-label="admin.referees.roleAriaLabel"`)
  - [ ] PIN (`aria-label="admin.referees.pinAriaLabel"`)
- [ ] 심판 편집/삭제
- [ ] 삭제 확인 모달 (포커스 트랩)

### 1-7. 코트 관리 (`/admin/courts`)
- [ ] 코트 목록 표시
- [ ] "코트 추가" → 모달
  - [ ] 코트 이름 (`aria-label="admin.courts.courtNameAriaLabel"`)
  - [ ] 위치 (`aria-label="admin.courts.locationAriaLabel"`)
  - [ ] 심판 배정 토글 (`aria-pressed`)
- [ ] 코트 편집/삭제

### 1-8. 관리자 설정 (`/admin/settings`)
- [ ] 비밀번호 변경 섹션 (`aria-expanded` 토글)
  - [ ] 현재 PIN → 새 PIN → 확인 → 변경 성공
  - [ ] 잘못된 현재 PIN → 에러
- [ ] 관리자 추가 섹션 (`aria-expanded` 토글)
  - [ ] 관리자 이름 입력 → 추가
- [ ] 관리자 목록 → 삭제
- [ ] 샘플 선수/심판 이름 설정
- [ ] 성공/에러 `role="alert"` 표시

---

## 2. Referee 모드

### 2-1. 심판 로그인 (`/referee`)
#### Step 1: 대회 선택
- [ ] 진행 중 대회 목록 표시 (상태 라벨 포함)
- [ ] 대회 없을 때 빈 상태 메시지
- [ ] 대회 클릭 → Step 2 이동

#### Step 2: 심판 선택
- [ ] 해당 대회의 심판 목록 (역할 뱃지: 주심/부심)
- [ ] 심판 없을 때 빈 상태 메시지
- [ ] 심판 클릭 → Step 3 이동
- [ ] 뒤로가기 → Step 1 복귀

#### Step 3: PIN 입력
- [ ] 4자리 PIN 입력 (`aria-required="true"`)
- [ ] 로그인 버튼 활성화 (PIN 4자리 입력 후)
- [ ] 올바른 PIN → `/referee/games` 이동
- [ ] 잘못된 PIN → `role="alert"` + `aria-live="assertive"` 에러
- [ ] 5회 실패 → 잠금 + 카운트다운
- [ ] 뒤로가기 → Step 2 복귀

#### 기타
- [ ] "모드 선택으로" 버튼 → `/` 이동
- [ ] "연습 모드" 버튼 → `/referee/practice`

### 2-2. 심판 홈 (`/referee/games`)
- [ ] 활성 경기 / 완료 경기 탭 (`role="tab"` + `aria-selected`)
- [ ] 내 경기만 / 전체 경기 토글 (`aria-pressed`)
- [ ] 경기 목록 (`role="list"` + `aria-label`)
  - [ ] 각 경기: 선수명, 상태, 코트, 시간 표시
  - [ ] `aria-setsize` + `aria-posinset` 올바른 값
- [ ] 경기 클릭 → 채점 화면 이동 (개인전: `/referee/match/...`, 팀전: `/referee/team/...`)
- [ ] 세션 복구: 이전 진행 중 경기 안내 + 계속/무시 선택
- [ ] 실시간 점수 `aria-live="polite"`
- [ ] 연습 모드 버튼
- [ ] 빈 상태 메시지

### 2-3. 개인전 채점 (`/referee/match/:tournamentId/:matchId`)
#### 코인토스
- [ ] 3판2선 코인토스 (각 라운드 클릭 → 결과)
- [ ] 승자 서브/리시브 선택

#### 점수 입력
- [ ] 각 선수 득점 버튼 (`aria-label="{선수명} +{점수}"`)
- [ ] 파울 버튼 → 파울 분류 오버레이
  - [ ] 파울 유형 선택 (`role="dialog"` + `aria-modal`)
  - [ ] 페널티 유형 선택
  - [ ] 닫기 버튼
- [ ] 서브 미스 (`aria-label="referee.scoring.serveMissAriaLabel"`)
- [ ] 데드볼
- [ ] 실행 취소 (`aria-label="common.undo"`)

#### 타임아웃
- [ ] 선수 타임아웃 (`aria-label="{선수명} timeout ({사용}/{총}"`)
- [ ] 의료 타임아웃
- [ ] 심판 타임아웃
- [ ] 타임아웃 모달: 타이머 표시 (`aria-live="polite"` + 경과 시간)
- [ ] 타임아웃 종료 버튼

#### 코트 체인지
- [ ] 세트 종료 시 코트 체인지 안내
- [ ] 예/아니오 선택

#### 경기 완료
- [ ] 최종 점수 확인 모달
- [ ] 경기 기록 저장 → 심판 홈 복귀

#### 점수 히스토리
- [ ] 세트별 그룹화 히스토리 (`aria-label="Set {n} history"`)
- [ ] 정렬 버튼 (최신순/오래된순)
- [ ] 각 액션 항목 설명 (`aria-label`)

### 2-4. 팀전 채점 (`/referee/team/:tournamentId/:matchId`)
#### 팀 순서 설정
- [ ] 팀원 순서 변경 (위/아래 버튼) (`aria-label="{팀원명} order up/down"`)
- [ ] 순서 확인 버튼

#### 코인토스 & 서브 선택
- [ ] 팀1/팀2 코인토스 버튼
- [ ] 승리팀 서브/리시브 선택

#### 코트 체인지
- [ ] `role="group"` + `aria-label="referee.scoring.courtChangeAriaLabel"`
- [ ] 예/아니오 선택

#### 워밍업 & 경기 시작
- [ ] 워밍업 시작 버튼
- [ ] 경기 시작 버튼

#### 채점 (개인전과 동일 기능)
- [ ] 점수 입력, 파울, 타임아웃, 실행 취소 등

### 2-5. 연습 모드

#### 연습 홈 (`/referee/practice`)
- [ ] 연습 모드 진입점 표시
- [ ] 나가기 버튼 (`aria-label="referee.practice.layout.exitAriaLabel"`)

#### 연습 설정 (`/referee/practice/setup`)
- [ ] 선수 이름 설정
- [ ] 경기 규칙 설정
- [ ] 설정 완료 → 연습 경기 시작

#### 연습 채점 (`/referee/practice/play`)
- [ ] 휘슬 버튼 (서브/골/종료)
  - [ ] 서브 휘슬 (`aria-label="referee.scoring.whistleServeAriaLabel"`)
  - [ ] 골 휘슬 (`aria-label="referee.scoring.whistleGoalAriaLabel"`)
  - [ ] 종료 휘슬 (`aria-label="referee.scoring.whistleEndAriaLabel"`)
- [ ] 득점 버튼 (P1/P2 골 +2)
- [ ] 파울 버튼 (P1/P2 파울)
- [ ] 데드볼 / 서브미스 / 실행취소
- [ ] 타임아웃 (선수/의료)
- [ ] 페널티 섹션 (`role="group"` + `aria-label`)

#### 연습 기록 (`/referee/practice/history`)
- [ ] 과거 연습 경기 목록
- [ ] 경기별 상세 점수 확인

---

## 3. Spectator 모드

### 3-1. 관람 홈 (`/spectator`)
- [ ] 대회 목록 표시
- [ ] 진행중 / 완료 필터 탭 (`role="tablist"` + `aria-label="spectator.home.filterAriaLabel"`)
  - [ ] 진행중 탭 기본 선택 (`aria-selected="true"`)
  - [ ] 탭 전환 시 목록 갱신
- [ ] 대회별 이름, 유형, 상태 표시
- [ ] 대회 클릭 → `/spectator/tournament/:id`
- [ ] `role="tabpanel"` 표시
- [ ] 로딩 상태 `role="status"` + `aria-live="polite"`
- [ ] 빈 상태 메시지 (진행중/완료 각각)
- [ ] 연습 경기 관람 링크

### 3-2. 대회 상세 (`/spectator/tournament/:id`)
#### 탭 네비게이션
- [ ] 5개 탭: 실시간 | 선수 | 순위 | 일정 | 심판
- [ ] `role="tablist"` + `aria-label="spectator.nav.label"`
- [ ] 각 탭 `aria-label` 번역 정상
- [ ] URL 경로와 탭 동기화 (`viewTab` 파라미터)
- [ ] 키보드 화살표 탭 전환

#### 실시간 탭 (LiveTab)
- [ ] 진행 중 매치 카드 표시
- [ ] 매치별 `aria-label="{P1} vs {P2}, {점수}, set score"`
- [ ] 스테이지 필터 (전체/예선/본선/순위결정전)
- [ ] 즐겨찾기 버튼 (`aria-label="add/remove favorite {선수명}"`)
- [ ] 매치 클릭 → 라이브 매치 뷰
- [ ] 실시간 점수 업데이트 (Firebase)

#### 선수 탭 (PlayersTab)
- [ ] 선수 검색 (`aria-label="spectator.tournament.searchAriaLabel"`)
- [ ] 선수 목록
- [ ] 즐겨찾기 토글 (`aria-label="add/remove favorite {선수명}"`)
- [ ] 프로필 링크 (`aria-label="{선수명} profile"`)
- [ ] 선수 클릭 → 선수 프로필 뷰

#### 순위 탭 (RankingTab)
- [ ] 순위 테이블 표시
- [ ] 테이블 접근성 (th, scope, caption 등)
- [ ] 정렬 동작

#### 일정 탭 (HistoryTab / ScheduleTab)
- [ ] 라운드별 경기 목록
- [ ] 더보기/접기 (`aria-label="show more/less {roundLabel}"`)
- [ ] 매치별 `aria-label="{P1} vs {P2}, {상태}"`

#### 심판 탭 (RefereesTab)
- [ ] 심판 검색 (`aria-label="spectator.tournament.referees.searchAriaLabel"`)
- [ ] 심판별 담당 경기 수 (`aria-label="{심판명}, {경기수} matches"`)
- [ ] 배정 경기 목록 (`role="list"` + `aria-label="assigned matches"`)

### 3-3. 라이브 매치 뷰 (`/spectator/match/:tournamentId/:matchId`)
- [ ] 실시간 점수 표시 (`aria-live="polite"` + `aria-label="score {P1} {점수} {P2}"`)
- [ ] 상태 변경 안내 (`aria-live="assertive"` — 경기 시작/종료)
- [ ] 세트 히스토리 표시
- [ ] 선수 통계 (있는 경우)
- [ ] 뒤로가기 네비게이션

### 3-4. 선수 프로필 (`/spectator/player/:tournamentId/:playerName`)
- [ ] 선수 정보 표시 (이름, 클럽, 클래스 등)
- [ ] 경기 통계
- [ ] 최근 경기 기록
- [ ] 즐겨찾기 토글

### 3-5. 즐겨찾기 (`/spectator/favorites`)
- [ ] 즐겨찾기한 선수 목록
- [ ] 알림 권한 요청
- [ ] 실시간 매치 알림
- [ ] 즐겨찾기 해제
- [ ] 빈 상태 (즐겨찾기 0명)

### 3-6. 연습 경기 관람 (`/spectator/practice`)
- [ ] 진행 중 연습 경기 목록
- [ ] 실시간 점수 확인
- [ ] 빈 상태 메시지

---

## 4. 에러 & 엣지 케이스

### 4-1. 네트워크
- [ ] Firebase 연결 끊김 시 적절한 에러 표시
- [ ] 오프라인 상태 안내
- [ ] 재연결 시 자동 복구

### 4-2. 데이터
- [ ] 빈 대회 (선수 0, 심판 0, 코트 0) 처리
- [ ] 긴 텍스트 (대회명, 선수명) 줄바꿈/말줄임
- [ ] 특수문자 포함 데이터 정상 표시

### 4-3. 동시성
- [ ] 두 심판이 같은 경기 동시 접근 시 충돌 방지
- [ ] 실시간 점수 업데이트 지연 시 일관성

### 4-4. 브라우저
- [ ] Chrome / Edge / Safari / Firefox 기본 동작
- [ ] 모바일 반응형 레이아웃
- [ ] 화면 확대 200% 시 레이아웃 깨짐 없음

---

## 감사 결과 요약

| 영역 | 총 항목 | 통과 | 실패 | 해당없음 |
|------|---------|------|------|----------|
| 공통 | | | | |
| Admin | | | | |
| Referee | | | | |
| Spectator | | | | |
| 에러/엣지 | | | | |
| **합계** | | | | |

---

*생성일: 2026-04-13*  
*도구: Playwright + Axe-Core (자동), NVDA/VoiceOver (수동)*
