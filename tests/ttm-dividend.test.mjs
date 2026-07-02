// node --test tests/ttm-dividend.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWon, computeTtmDps, ttmYield, isUnusualYield, dividendDisplay } from '../scripts/lib/ttm-dividend.mjs';

test('parseWon: 다양한 실데이터 포맷', () => {
  assert.equal(parseWon('73원'), 73);
  assert.equal(parseWon('약 96원'), 96);                 // 근사치
  assert.equal(parseWon('보통 182원 / 종류 411원'), 182); // 종류주 병기 → 보통주
  assert.equal(parseWon('2,248원'), 2248);               // 콤마
  assert.equal(parseWon('0원(무배당)'), 0);
  assert.equal(parseWon('미정'), null);
  assert.equal(parseWon('배당 실시'), null);              // 금액 없음
  assert.equal(parseWon(null), null);
});

const reit = (divMonths, history) => ({ divMonths, reportDetail: { dividends: { history } } });

test('computeTtmDps: 분기(freq=4) 4회 합산', () => {
  const r = reit([2, 5, 8, 11], [
    { period: '제4기', perShare: '73원', note: '' }, { period: '제3기', perShare: '73원', note: '' },
    { period: '제2기', perShare: '73원', note: '' }, { period: '제1기', perShare: '98원', note: '' }]);
  const t = computeTtmDps(r);
  assert.equal(t.ttmDps, 317); assert.equal(t.freq, 4); assert.equal(t.quality, 'actual');
});

test('computeTtmDps: 반기 + 미확정 회차 스킵', () => {
  const r = reit([6, 12], [
    { period: '제14기 반기', perShare: '미정', note: '⚠ 미확정' },
    { period: '제13기', perShare: '115원', note: '배당총액 227억' },
    { period: '제12기', perShare: '115원', note: '' }]);
  const t = computeTtmDps(r);
  assert.equal(t.ttmDps, 230); assert.equal(t.periodsUsed, 2); assert.equal(t.quality, 'actual');
});

test('computeTtmDps: 특별배당 포함 → special', () => {
  const r = reit([5, 11], [
    { period: '제13기', perShare: '625원', note: '수익률 13.01%(자산 처분이익 등 반영)' },
    { period: '제12기', perShare: '126원', note: '' }]);
  const t = computeTtmDps(r);
  assert.equal(t.ttmDps, 751); assert.equal(t.quality, 'special'); assert.equal(t.hasSpecial, true);
});

test('computeTtmDps: 누적행 제외', () => {
  const r = reit([5, 11], [
    { period: '제13기 (2026.02)', perShare: '160원', note: '' },
    { period: '제12기 (2025.08)', perShare: '232원', note: '' },
    { period: '상장 후 누적', perShare: '2,248원', note: '공모가 5,000원' }]);
  const t = computeTtmDps(r);
  assert.equal(t.ttmDps, 392);   // 160+232, 누적 2248 제외
});

test('computeTtmDps: 분기인데 3회만 → partial', () => {
  const r = reit([1, 4, 7, 10], [
    { period: '제13기', perShare: '69원', note: '' }, { period: '제12기', perShare: '69원', note: '' },
    { period: '제11기', perShare: '69원', note: '' }]);
  const t = computeTtmDps(r);
  assert.equal(t.ttmDps, 207); assert.equal(t.quality, 'partial'); assert.equal(t.periodsUsed, 3);
});

test('computeTtmDps: 무배당 → nodiv', () => {
  const r = reit([12], [
    { period: '제12기', perShare: '0원(무배당)', note: '당기순손실' },
    { period: '제11기', perShare: '0원(무배당)', note: '' }]);
  const t = computeTtmDps(r);
  assert.equal(t.ttmDps, 0); assert.equal(t.quality, 'nodiv');
});

test('computeTtmDps: 배당성향 100% 초과 감지', () => {
  const r = reit([6, 12], [
    { period: '제40기', perShare: '176원', note: '배당총액 112억 · 배당성향 161%' },
    { period: '제39기', perShare: '174원', note: '수익률 3.9%' }]);
  const t = computeTtmDps(r);
  assert.equal(t.payoutOver100, true);
  const r2 = reit([3, 6, 9, 12], [{ period: '제20기', perShare: '68원', note: '배당성향 99%' }]);
  assert.equal(computeTtmDps(r2).payoutOver100, false);   // 99% < 100
});

test('ttmYield / isUnusualYield', () => {
  assert.equal(ttmYield(274, 3380), 8.11);
  assert.equal(ttmYield(0, 971), 0);
  assert.equal(ttmYield(100, 0), null);
  assert.equal(isUnusualYield(27.8), true);
  assert.equal(isUnusualYield(8.1), false);
});

test('dividendDisplay: 배지·경고 우선순위', () => {
  // 특별배당
  let d = dividendDisplay({ ttmDps: 751, ttmQuality: 'special', ttmSpecial: true, ttmPayoutOver100: false, ttmApprox: false }, 3805);
  assert.equal(d.badge, '특별배당 포함'); assert.equal(d.tone, 'warn'); assert.ok(d.yield > 0);
  // 배당성향
  d = dividendDisplay({ ttmDps: 350, ttmQuality: 'actual', ttmSpecial: false, ttmPayoutOver100: true, ttmApprox: false }, 3415);
  assert.equal(d.badge, '배당성향 100%↑');
  // 이례적
  d = dividendDisplay({ ttmDps: 340, ttmQuality: 'actual', ttmSpecial: false, ttmPayoutOver100: false, ttmApprox: false }, 1339);
  assert.equal(d.badge, '이례적·확인');
  // 무배당
  d = dividendDisplay({ ttmDps: 0, ttmQuality: 'nodiv' }, 971);
  assert.equal(d.isDiv, false); assert.equal(d.badge, '무배당');
  // 정상
  d = dividendDisplay({ ttmDps: 274, ttmQuality: 'actual', ttmSpecial: false, ttmPayoutOver100: false, ttmApprox: false }, 3380);
  assert.equal(d.badge, '실적'); assert.equal(d.tone, 'ok');
  // 산정 불가
  assert.equal(dividendDisplay({ ttmDps: null, ttmQuality: 'none' }, 1000).show, false);
});
