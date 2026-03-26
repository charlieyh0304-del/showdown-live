// Stub: 기존 firebase-messaging-sw.js 등록을 자동 해제
// 이제 모든 push 처리는 VitePWA의 sw.js에서 담당
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(self.registration.unregister());
});
