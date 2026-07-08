import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePct, sustainabilitySignals, signalCounts } from '../scripts/lib/sustainability.mjs';

test('parsePct: %문자열에서 숫자 추출', () => {
  assert.equal(parsePct('배당성향 132.9%'), 132.9);
  assert.equal(parsePct('LTV 55%'), 55);
  assert.equal(parsePct('미기재'), null);
  assert.equal(parsePct(null), null);
});

test('배당성향 note에서 실제값 파싱 → 100% 초과는 alert', () => {
  const r = { ttmQuality: 'actual' };
  const detail = { sourceUrl: 'http://x', asOf: '2026-01-01', dividends: { history: [{ period: '제11기', note: '배당총액 78.6억 · 연결 배당성향 132.9%' }] } };
  const S = sustainabilitySignals(r, {}, detail);
  const payout = S.find((s) => s.label === '배당성향');
  assert.ok(payout);
  assert.equal(payout.level, 'alert');
  assert.match(payout.text, /132\.9%/);
  assert.equal(payout.source, 'http://x');
});

test('배당성향 90~100%는 watch, 90 미만은 ok', () => {
  const mk = (p) => sustainabilitySignals({}, {}, { dividends: { history: [{ period: 'p', note: '배당성향 ' + p + '%' }] } }).find((s) => s.label === '배당성향');
  assert.equal(mk(95).level, 'watch');
  assert.equal(mk(70).level, 'ok');
});

test('LTV 실측: 60↑ alert, 50~60 watch, 미만 ok · 미확인은 na', () => {
  const mkLtv = (v, status = 'actual') => ({ ltv: { value: v, display: v + '%', status, sourceUrl: 's', asOf: 'a' } });
  assert.equal(sustainabilitySignals({}, mkLtv(65), {}).find((s) => s.label.startsWith('LTV')).level, 'alert');
  assert.equal(sustainabilitySignals({}, mkLtv(55), {}).find((s) => s.label.startsWith('LTV')).level, 'watch');
  assert.equal(sustainabilitySignals({}, mkLtv(40), {}).find((s) => s.label.startsWith('LTV')).level, 'ok');
  // 미확인(unavailable) → na
  assert.equal(sustainabilitySignals({}, { ltv: { value: null, status: 'unavailable' } }, {}).find((s) => s.label.startsWith('LTV')).level, 'na');
});

test('무배당·중대리스크·순손실은 alert', () => {
  const S1 = sustainabilitySignals({ ttmQuality: 'nodiv' }, {}, {});
  assert.ok(S1.some((s) => s.level === 'alert' && s.label === '최근 12개월 배당'));
  const S2 = sustainabilitySignals({ risk: { level: 'high', label: '회생절차', note: 'x' } }, {}, {});
  assert.ok(S2.some((s) => s.level === 'alert' && s.label === '중대 리스크'));
  const S3 = sustainabilitySignals({}, {}, { financials: [{ label: '당기순이익', value: '순손실 -50억' }] });
  assert.ok(S3.some((s) => s.level === 'alert' && s.label === '손익'));
});

test('특별배당·저고정금리는 watch', () => {
  const S = sustainabilitySignals({ ttmSpecial: true }, { debtFixedRatio: { value: 20, display: '20%', status: 'actual' } }, {});
  assert.ok(S.some((s) => s.level === 'watch' && s.label === '특별배당 포함'));
  assert.ok(S.some((s) => s.level === 'watch' && s.label === '고정금리 비중'));
});

test('signalCounts: 레벨별 집계', () => {
  const S = [{ level: 'ok' }, { level: 'ok' }, { level: 'watch' }, { level: 'alert' }, { level: 'na' }];
  assert.deepEqual(signalCounts(S), { ok: 2, watch: 1, alert: 1, na: 1 });
});
