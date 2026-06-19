/* 리츠온 서비스워커 — 네트워크 우선(항상 최신), 오프라인 시 캐시 폴백.
   온라인 사용자는 늘 최신 버전을 받고, 오프라인에서만 캐시를 사용합니다. */
const CACHE = 'reiton-v1';
const ASSETS = ['./', './index.html', './favicon.svg', './apple-touch-icon.png', './og.png', './partners.json'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // API·광고 등 외부 요청은 그대로 통과
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
  );
});
