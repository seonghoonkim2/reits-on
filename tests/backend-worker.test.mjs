// node --test tests/backend-worker.test.mjs
// 네트워크 없이 워커 라우팅·CORS·시세 경로를 검증(global fetch/caches 모의).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../backend/worker.mjs';

const origFetch = globalThis.fetch;
const origCaches = globalThis.caches;

function install(routes) {
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
  globalThis.fetch = async (url) => {
    const sym = decodeURIComponent(String(url).split('/chart/')[1]?.split('?')[0] || '');
    if (routes[sym]) return { ok: true, json: async () => ({ chart: { result: [{ meta: routes[sym] }] } }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
}
function restore() { globalThis.fetch = origFetch; globalThis.caches = origCaches; }

test('GET /healthz → ok', async () => {
  install({});
  const res = await worker.fetch(new Request('https://x/healthz'));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  restore();
});

test('GET /v1/prices?tickers= → 시세 + CORS', async () => {
  install({ '365550.KS': { regularMarketPrice: 3445, chartPreviousClose: 3680, currency: 'KRW', regularMarketTime: 1782196228 } });
  const res = await worker.fetch(new Request('https://x/v1/prices?tickers=365550'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  const body = await res.json();
  assert.equal(body.count, 1);
  assert.equal(body.prices['365550'].price, 3445);
  assert.equal(body.prices['365550'].changePct, -6.39);
  restore();
});

test('OPTIONS → CORS 프리플라이트', async () => {
  install({});
  const res = await worker.fetch(new Request('https://x/v1/prices', { method: 'OPTIONS' }));
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.match(res.headers.get('access-control-allow-methods'), /GET/);
  restore();
});

test('알 수 없는 경로 → 404', async () => {
  install({});
  const res = await worker.fetch(new Request('https://x/nope'));
  assert.equal(res.status, 404);
  restore();
});
