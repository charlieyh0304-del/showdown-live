# 대회 결과 표시 UX 토론 결과

> 2026-03-20 | 5명 토론 에이전트 분석 결과 종합

---

## 1. 접근성 전문가 분석

### 주요 문제점
- 점수 표시에 aria-label 없음 (스크린리더가 "7", "대시", "11"로 분리 읽음)
- 승/패 구분이 색상에만 의존 (색맹/스크린리더 사용자 인식 불가)
- 탭 패널에 키보드 화살표 네비게이션 미구현
- 순위표 `<caption>` 누락, `scope="row"` 미적용
- NxN 크로스테이블이 스크린리더로 탐색 불가

### 우선순위 권장사항
| 우선순위 | 항목 | 난이도 |
|----------|------|--------|
| P0 | 모든 점수 표시에 전체 맥락 aria-label 추가 | 중 |
| P0 | 색상 외 텍스트 기반 승/패 표시 추가 | 하 |
| P1 | 탭 컴포넌트 화살표 키 네비게이션 | 중 |
| P1 | 순위표 caption + scope="row" | 하 |
| P2 | NxN 크로스테이블 대안 목록 뷰 제공 | 상 |

---

## 2. 스포츠 UX 패턴 분석

### 프로 스포츠 앱 공통 패턴
- **점진적 공개**: 개요 먼저, 탭/클릭으로 상세
- **시각적 브래킷 트리**: 엘리미네이션은 반드시 트리 형태
- **색상 코딩된 진출 표시**: 상위 N명 녹색 하이라이트
- **고정 헤더**: 스크롤 시 라운드 라벨 유지
- **점수 타이포그래피**: tabular-nums, 큰 글꼴

### 추천 탭 구조 (6탭 → 3탭)
1. **Overview**: 라이브 배너 + 대회 진행률 + 최근 결과
2. **Tournament**: 조별리그 + 브래킷 + 순위결정전 (연결된 수직 스크롤)
3. **Standings**: 최종 순위 + 드릴다운

### 예선→본선 시각적 연결
- 조별 순위표 하단에 "진출 → 8강 #1" 표시
- 파란색(예선) → 초록색(본선) 색상 시스템 일관 적용
- 진출 화살표/연결선으로 어느 조 1위가 어느 브래킷으로 가는지 표시

---

## 3. 관리자 관점 분석

### 실시간 운영 시 필요한 정보
- 현재 진행중인 경기 수 + 코트별 점수
- 다음 시작할 경기 대기열
- 코트 활용 현황 (사용중/대기)
- 심판 배정 현황 + 워크로드

### 현재 누락된 기능
- 점수 수정 메커니즘 (분쟁 해결)
- 부전승/기권/실격 처리
- 감사 추적 (점수 변경 이력)
- 보고서/내보내기 기능

### 관리자 vs 관람자 차이점
| 측면 | 관리자 | 관람자 |
|------|--------|--------|
| 점수 | 편집 가능 + 감사 로그 | 읽기 전용 |
| 경기 상태 | 시작/중지/부전승 가능 | 관찰만 |
| 선수 데이터 | 등급/소속/성별 전체 | 이름/등급만 |
| 내보내기 | 전체 데이터 | 없음 |

---

## 4. 관람자 경험 분석

### 메인 페이지 개선
- "Live Now" 히어로 섹션 (모든 대회 라이브 경기 통합)
- 즐겨찾기 선수 스트립 (상태 표시)
- 최근 결과 티커 (가로 스크롤)
- 대회 진행률 바

### 선수 프로필 개선
- 최근 5경기 폼 인디케이터 (승/패 컬러 도트)
- 상대 전적 (Head-to-Head)
- 승률 퍼센트 + 시각적 바
- 세트당 평균 포인트
- 공유 버튼 (Web Share API)

### 라이브 경기 개선
- 점수 변경 애니메이션
- 듀스/매치포인트 특별 표시
- 경과 시간 표시
- 연속 득점 모멘텀 인디케이터

### 알림 시스템 개선
- "경기 시작" 알림 추가 (현재 없음)
- 듀스/매치포인트 알림
- 인앱 알림 센터 (벨 아이콘)
- 알림 세분화 설정

---

## 5. 데이터 아키텍처 분석

### 현재 데이터 모델 부족한 점
- `Match`에 `completedAt` 타임스탬프 없음
- `walkover`/`forfeit` 필드 미정의 (코드에서 타입 캐스팅으로 우회)
- `TeamRanking`에 `setsWon`/`setsLost` 누락
- `head_to_head` 타이브레이커 선언만 되고 미구현
- 스테이지별 순위 스냅샷 없음

### 추가 필요한 타입
```typescript
// 경기 결과 요약 (Match와 분리)
interface MatchResult {
  matchId: string;
  winnerId: string;
  score: string;                    // "2-1"
  setScores: [number, number][];    // [[11,7],[9,11],[11,5]]
  durationMinutes?: number;
  completedAt: number;
  walkover?: boolean;
}

// 선수 대회 통계
interface PlayerTournamentStats {
  matchesPlayed: number;
  wins: number; losses: number;
  setsWon: number; setsLost: number;
  pointsFor: number; pointsAgainst: number;
  goalsScored: number;
  faultsCommitted: number;
  winRate: number;
  currentStreak: number;
  longestWinStreak: number;
}

// 최종 순위 (불변)
interface TournamentStanding {
  finalRank: number;
  participantId: string;
  determinedBy: 'bracket_finish' | 'group_ranking' | 'ranking_match';
  stageResults: StageResult[];
}
```

### Match 타입 수정 권장
- `completedAt?: number` 추가
- `walkover?: boolean` 추가
- `matchDurationSeconds?: number` 추가
- `matchOrder?: number` 추가

### 구현 우선순위
1. **즉시**: `completedAt`, `walkover` 추가, `TeamRanking` 세트 필드 추가, `head_to_head` 구현
2. **단기**: `MatchResult`, `TournamentStanding` 타입 생성, 스테이지별 순위 스냅샷
3. **중기**: `PlayerProfile` 커리어 통계, `ScoreHistoryEntry` ID 기반으로 전환
4. **장기**: `Match` 분리 (구조 / 라이브 상태 / 결과)

---

## 종합 우선순위 매트릭스

### 높은 임팩트 + 낮은 노력
1. 라이브 경기를 상단 배너로 (탭 아닌 상시 표시)
2. 점수 변경 시 CSS 애니메이션
3. 선수 프로필에 최근 5경기 폼 표시
4. Web Share API로 공유 버튼 추가
5. 모든 점수에 aria-label 추가

### 높은 임팩트 + 중간 노력
6. 싱글 엘리미네이션 비주얼 브래킷 트리
7. 조별 순위 → 본선 브래킷 연결 표시
8. 인앱 알림 센터
9. 관리자 코트 중심 실시간 대시보드
10. 점수 수정 워크플로우

### 중간 임팩트 + 높은 노력
11. 크로스 토너먼트 커리어 통계
12. 순위표 이미지 생성 (공유용)
13. 대회장 QR 코드 생성
14. Match 타입 분리 리팩토링
