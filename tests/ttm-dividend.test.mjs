// node --test tests/ttm-dividend.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWon, computeTtmDps, ttmYield, isUnusualYield, dividendDisplay, dividendSeries } from '../scripts/lib/ttm-dividend.mjs';

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

test('dividendSeries: 오래된→최근 순, 특별배당 플래그, 미확정/누적 제외', () => {
  const r = reit([5, 11], [
    { period: '제14기 반기', perShare: '미정', note: '' },
    { period: '제13기', perShare: '625원', note: '자산 처분이익 반영' },
    { period: '제12기', perShare: '126원', note: '' },
    { period: '상장 후 누적', perShare: '2,248원', note: '' }]);
  const s = dividendSeries(r);
  assert.equal(s.length, 2);                     // 미정·누적 제외
  assert.equal(s[0].period, '12기');             // 오래된 것 먼저
  assert.equal(s[1].period, '13기');
  assert.equal(s[1].value, 625);
  assert.equal(s[1].special, true);              // 처분이익 → 특별배당
});

test('dividendSeries: 무배당은 value 0으로 포함', () => {
  const r = reit([12], [{ period: '제12기 (2025)', perShare: '0원(무배당)', note: '' }, { period: '제11기 (2024)', perShare: '0원(무배당)', note: '' }]);
  const s = dividendSeries(r);
  assert.equal(s.length, 2);
  assert.equal(s[0].value, 0);
  assert.equal(s[0].period, '11기');             // 제N기 우선 라벨(오래된 것 먼저)
  // 연도만 있는 경우 연도 라벨
  const r2 = reit([12], [{ period: '2025', perShare: '50원', note: '' }, { period: '2024', perShare: '40원', note: '' }]);
  assert.equal(dividendSeries(r2)[0].period, "'24");
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

// ---- 신선도(stale) 감지: 최신 회차가 오래되면 '갱신지연' ----
import { periodEndYM } from '../scripts/lib/ttm-dividend.mjs';

test('periodEndYM: 다양한 회차 라벨에서 종료 연월 추정', () => {
  assert.deepEqual(periodEndYM('제10기 (2025.05 결산)'), { y: 2025, m: 5 });
  assert.deepEqual(periodEndYM('제11기 (2025.07~12)'), { y: 2025, m: 12 });
  assert.deepEqual(periodEndYM('제16기 (2025)'), { y: 2025, m: 12 });
  assert.deepEqual(periodEndYM('2026.1Q'), { y: 2026, m: 3 });
  assert.equal(periodEndYM('11기'), null);   // 연도 없음 → 판단 보류
});

test('TTM stale: 반기배당인데 최신 회차가 13개월 전이면 stale=true', () => {
  const old = new Date(); old.setMonth(old.getMonth() - 13);
  const ym = `${old.getFullYear()}.${String(old.getMonth() + 1).padStart(2, '0')}`;
  const reit = { divMonths: [5, 11], reportDetail: { dividends: { history: [
    { period: `제9기 (${ym} 결산)`, perShare: '137원' },
    { period: '제8기', perShare: '137원' },
  ] } } };
  const t = computeTtmDps(reit);
  assert.equal(t.stale, true);
  assert.equal(t.quality, 'actual');   // 품질 분류는 유지, 신선도만 플래그
});

test('TTM stale: 최신 회차가 신선하면 stale=false, 연도 미상도 false(보류)', () => {
  const now = new Date();
  const ym = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}`;
  const fresh = { divMonths: [5, 11], reportDetail: { dividends: { history: [
    { period: `제9기 (${ym} 결산)`, perShare: '137원' }, { period: '제8기', perShare: '137원' },
  ] } } };
  assert.equal(computeTtmDps(fresh).stale, false);
  const unknown = { divMonths: [5, 11], reportDetail: { dividends: { history: [
    { period: '9기', perShare: '137원' }, { period: '8기', perShare: '137원' },
  ] } } };
  assert.equal(computeTtmDps(unknown).stale, false);
});
