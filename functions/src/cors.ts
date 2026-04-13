/**
 * CORS 허용 도메인 (공통 모듈)
 *
 * 프로덕션: localhost 제외
 * 개발/에뮬레이터: localhost 포함
 */

const PRODUCTION_ORIGINS = [
  "https://showdown-b5cc7.web.app",
  "https://showdown-b5cc7.firebaseapp.com",
  "https://showdown-staging.web.app",
  "https://showdown-staging.firebaseapp.com",
  "https://charlieyh0304-del.github.io",
];

const DEV_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:4173",
];

// Cloud Functions 환경에서 FUNCTIONS_EMULATOR === "true" 이면 에뮬레이터
const isDev = process.env.FUNCTIONS_EMULATOR === "true";

export const ALLOWED_ORIGINS = isDev
  ? [...PRODUCTION_ORIGINS, ...DEV_ORIGINS]
  : PRODUCTION_ORIGINS;
