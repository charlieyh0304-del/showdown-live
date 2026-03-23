// 이전 커스텀 SW를 자동 해제하기 위한 noop SW
// 브라우저가 이 파일을 받으면 기존 캐시를 지우고 자신을 해제합니다
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll())
      .then(clients => clients.forEach(c => c.navigate(c.url)))
  );
});
