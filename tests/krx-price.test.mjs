// node --test tests/krx-price.test.mjs
// 네트워크 없이 검증: 모의 fetch로 Yahoo 응답 파싱·심볼 폴백·계산 로직을 고정한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchQuote, fetchQuotes, yieldFromPrice } from '../scripts/lib/krx-price.mjs';

// meta를 받아 Yahoo chart 응답 형태로 감싸는 헬퍼
const chart = (meta) => ({ ok: true, json: async () => ({ chart: { result: [{ meta }] } }) });
const notFound = { ok: false, status: 404, json: async () => ({}) };
// 호출된 URL을 기록하는 모의 fetch 팩토리. routes: { 'SYMBOL': response }
function mockFetch(routes, calls = []) {
  return async (url) => {
    calls.push(url);
    const sym = decodeURIComponent(url.split('/chart/')[1].split('?')[0]);
    return routes[sym] ?? notFound;
  };
}

test('fetchQuote: KS에서 가격·변동률·기준일 파싱', async () => {
  const fetchImpl = mockFetch({
    '365550.KS': chart({ regularMarketPrice: 3445, chartPreviousClose: 3680, currency: 'KRW', regularMarketTime: 1782196228 }),
  });
  const q = await fetchQuote('365550', { fetchImpl, gapMs: 0 });
  assert.equal(q.price, 3445);
  assert.equal(q.prevClose, 3680);
  assert.equal(q.changePct, -6.39);            // (3445-3680)/3680*100, 반올림 2자리
  assert.equal(q.currency, 'KRW');
  assert.equal(q.symbol, '365550.KS');
  assert.match(q.priceAsOf, /^\d{4}-\d{2}-\d{2}$/);
});

test('fetchQuote: KS 미존재 → KQ 폴백', async () => {
  const calls = [];
  const fetchImpl = mockFetch({
    '900100.KQ': chart({ regularMarketPrice: 1000, chartPreviousClose: 1000, currency: 'KRW' }),
  }, calls);
  const q = await fetchQuote('900100', { fetchImpl });
  assert.equal(q.symbol, '900100.KQ');
  assert.equal(q.price, 1000);
  assert.equal(q.changePct, 0);                // 보합
  assert.ok(calls.some((u) => u.includes('900100.KS')));  // KS를 먼저 시도
  assert.ok(calls.some((u) => u.includes('900100.KQ')));
});

test('fetchQuote: 가격 0/누락이면 null (가짜 시세 방지)', async () => {
  const fz = mockFetch({ '000000.KS': chart({ regularMarketPrice: 0, currency: 'KRW' }) });
  assert.equal(await fetchQuote('000000', { fetchImpl: fz }), null);
  const fn = mockFetch({ '111111.KS': chart({ currency: 'KRW' }) });
  assert.equal(await fetchQuote('111111', { fetchImpl: fn }), null);
});

test('fetchQuote: prevClose 없으면 changePct=null', async () => {
  const fetchImpl = mockFetch({ '222222.KS': chart({ regularMarketPrice: 500, currency: 'KRW' }) });
  const q = await fetchQuote('222222', { fetchImpl });
  assert.equal(q.price, 500);
  assert.equal(q.changePct, null);
});

test('fetchQuotes: 일부 실패해도 성공분만 맵으로 반환', async () => {
  const fetchImpl = mockFetch({
    '365550.KS': chart({ regularMarketPrice: 3445, chartPreviousClose: 3680, currency: 'KRW' }),
    // 330590 은 어떤 심볼도 없음 → 누락
  });
  const out = await fetchQuotes(['365550', '330590'], { fetchImpl, gapMs: 0 });
  assert.equal(Object.keys(out).length, 1);
  assert.equal(out['365550'].price, 3445);
  assert.equal(out['330590'], undefined);
});

test('yieldFromPrice: DPS/현재가, 가드', () => {
  assert.equal(yieldFromPrice(278, 3445), 8.07);
  assert.equal(yieldFromPrice(null, 3445), null);
  assert.equal(yieldFromPrice(278, 0), null);
  assert.equal(yieldFromPrice(278, null), null);
});
