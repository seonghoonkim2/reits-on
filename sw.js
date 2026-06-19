/* 리츠온 서비스워커 — 네트워크 우선(항상 최신), 오프라인 시 캐시 폴백.
   온라인 사용자는 늘 최신 버전을 받고, 오프라인에서만 캐시를 사용합니다. */
const CACHE = 'reiton-v2';
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

// 웹 푸시: payload 없이 와도 일반 문구로 알림 표시
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) { data = {}; }
  const title = data.title || '리츠온 — 새 공시 알림';
  const body = data.body || '관심 가질 만한 새 공시·배당 정보가 올라왔어요. 눌러서 확인하세요.';
  const url = data.url || './';
  e.waitUntil(self.registration.showNotification(title, {
    body, icon: './icon-192.png', badge: './favicon-32.png', tag: 'reiton-filing', data: { url }
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((ws) => {
    for (const w of ws) { if ('focus' in w) { w.navigate && w.navigate(url); return w.focus(); } }
    return self.clients.openWindow(url);
  }));
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
