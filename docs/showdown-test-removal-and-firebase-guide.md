# Showdown 프로젝트 관리 가이드

## 1. showdown-test 저장소 제거

### 1-1. GitHub 원격 저장소 삭제

1. GitHub에 로그인
2. `https://github.com/charlieyh0304-del/showdown-test` 접속
3. **Settings** 탭 클릭 (상단 메뉴 맨 오른쪽)
4. 페이지 맨 아래로 스크롤 → **Danger Zone** 섹션
5. **Delete this repository** 클릭
6. 확인 입력란에 `charlieyh0304-del/showdown-test` 입력
7. **I understand the consequences, delete this repository** 클릭

### 1-2. 로컬 gh-pages 캐시 정리

showdown-test의 gh-pages 캐시가 로컬에 남아 있을 수 있습니다.

```bash
# 프로젝트 폴더에서 실행
rm -rf node_modules/.cache/gh-pages
```

### 1-3. GitHub Pages 배포가 남아 있는 경우

저장소 삭제 시 GitHub Pages도 자동으로 비활성화됩니다. 별도 조치 불필요.

---

## 2. showdown-live Firebase 사용 가이드

### 2-1. Firebase 콘솔 접속

- URL: **https://console.firebase.google.com**
- Google 계정으로 로그인
- 프로젝트 목록에서 showdown-live 프로젝트 선택

### 2-2. 주요 메뉴 안내

#### Realtime Database (데이터 관리)

경로: 콘솔 좌측 메뉴 → **빌드** → **Realtime Database**

| 데이터 경로 | 설명 |
|-------------|------|
| `tournaments/` | 대회 정보 (이름, 유형, 상태, 규칙 등) |
| `matches/{대회ID}/` | 경기 데이터 (점수, 세트, 히스토리 등) |
| `tournamentPlayers/{대회ID}/` | 대회별 참가 선수 |
| `teams/{대회ID}/` | 대회별 팀 구성 |
| `schedule/{대회ID}/` | 경기 스케줄 |
| `players/` | 전역 선수 목록 |
| `referees/` | 심판 목록 |
| `courts/` | 경기장 목록 |
| `notifications/` | 알림 |

**데이터 조회/수정**:
1. 데이터 경로를 클릭하여 트리 탐색
2. 값을 클릭하면 직접 수정 가능
3. 우측 **+** 버튼으로 새 데이터 추가
4. 항목에 마우스를 올리면 **X** 버튼으로 삭제

**데이터 내보내기/가져오기**:
1. 데이터 탭 상단 **⋮** (점 3개) 메뉴 클릭
2. **JSON 내보내기** → 전체 데이터 백업
3. **JSON 가져오기** → 데이터 복원 (기존 데이터 덮어쓰기 주의)

#### 보안 규칙 (Rules)

경로: Realtime Database → **규칙** 탭

현재 적용된 규칙:
```json
{
  "rules": {
    "tournaments": {
      ".read": true,
      "$tournamentId": {
        ".write": true,
        ".validate": "newData.hasChildren(['name', 'type', 'status'])"
      }
    },
    "matches": { ".read": true, "$tournamentId": { ".write": true } },
    "tournamentPlayers": { ".read": true, "$tournamentId": { ".write": true } },
    "teams": { ".read": true, "$tournamentId": { ".write": true } },
    "schedule": { ".read": true, "$tournamentId": { ".write": true } },
    "players": { ".read": true, ".write": true },
    "referees": { ".read": true, ".write": true },
    "courts": { ".read": true, ".write": true },
    "notifications": { ".read": true, ".write": true }
  }
}
```

- 모든 데이터는 누구나 읽기 가능 (관람 모드용)
- 쓰기는 경로별로 허용

규칙 수정 후 반드시 **게시** 버튼 클릭.

### 2-3. 프로젝트 설정 (API 키 확인)

경로: 콘솔 좌측 **⚙ 프로젝트 설정** → **일반** → **내 앱**

여기서 확인할 수 있는 값들:

| 항목 | 환경변수명 | 용도 |
|------|-----------|------|
| API 키 | `VITE_FIREBASE_API_KEY` | Firebase 인증 |
| Auth 도메인 | `VITE_FIREBASE_AUTH_DOMAIN` | 인증 도메인 |
| Database URL | `VITE_FIREBASE_DATABASE_URL` | Realtime DB 주소 |
| 프로젝트 ID | `VITE_FIREBASE_PROJECT_ID` | 프로젝트 식별 |
| Storage 버킷 | `VITE_FIREBASE_STORAGE_BUCKET` | 파일 저장소 |
| Sender ID | `VITE_FIREBASE_MESSAGING_SENDER_ID` | 푸시 알림 |
| App ID | `VITE_FIREBASE_APP_ID` | 앱 식별 |

### 2-4. 로컬 개발 환경 설정

프로젝트 루트에 `.env` 파일 생성 (`.env.example` 참고):

```env
VITE_FIREBASE_API_KEY=실제값
VITE_FIREBASE_AUTH_DOMAIN=실제값
VITE_FIREBASE_DATABASE_URL=실제값
VITE_FIREBASE_PROJECT_ID=실제값
VITE_FIREBASE_STORAGE_BUCKET=실제값
VITE_FIREBASE_MESSAGING_SENDER_ID=실제값
VITE_FIREBASE_APP_ID=실제값
```

> `.env` 파일은 `.gitignore`에 포함되어 있어 git에 커밋되지 않습니다.

### 2-5. GitHub Actions 배포 시 환경변수

GitHub 저장소 → **Settings** → **Secrets and variables** → **Actions**

위 환경변수들이 Repository secrets로 등록되어 있어야 합니다.
`main` 브랜치에 push하면 자동으로 GitHub Pages에 배포됩니다.

### 2-6. 데이터 초기화 (전체 리셋)

대회 데이터를 모두 지우고 싶을 때:

1. Firebase 콘솔 → Realtime Database
2. 루트 노드 (`/`) 선택
3. **X** 버튼 클릭 → 전체 삭제

또는 특정 대회만 삭제:
- 앱의 관리자 모드에서 대회 삭제 (암호 입력 필요, 기본값: `1234`)
- 관련 데이터(경기, 팀, 스케줄 등)가 함께 삭제됩니다

### 2-7. 사용량 모니터링

경로: 콘솔 좌측 → **Realtime Database** → **사용량** 탭

무료 플랜(Spark) 제한:
| 항목 | 제한 |
|------|------|
| 동시 접속 | 100명 |
| 저장 용량 | 1GB |
| 다운로드 | 10GB/월 |

사용량이 한도에 근접하면 이메일 알림이 옵니다.

---

## 3. 현재 배포 구조 요약

```
[로컬 개발]
  npm run dev → localhost:5173
  .env 파일로 Firebase 연결

[배포 (자동)]
  git push origin main
    → GitHub Actions (.github/workflows/pages.yml)
    → npm run build (DEPLOY_TARGET=github)
    → GitHub Pages에 배포
    → https://charlieyh0304-del.github.io/showdown-live/

[데이터]
  Firebase Realtime Database (실시간 동기화)
  모든 클라이언트(관리자/심판/관람)가 같은 DB 사용
```
