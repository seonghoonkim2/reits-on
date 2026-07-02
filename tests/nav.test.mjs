// node --test tests/nav.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEok, navTotalWon, sharesOutstanding, computePnav } from '../scripts/lib/nav.mjs';

test('parseEok: 조·억 혼합 파싱', () => {
  assert.equal(parseEok('약 8,016억원'), 8016);
  assert.equal(parseEok('약 1조 1,620억원'), 11620);
  assert.equal(parseEok('약 2조 6,270억원'), 26270);
  assert.equal(parseEok('약 1.11조원'), 11100);
  assert.equal(parseEok('약 3.13조원'), 31300);
  assert.equal(parseEok('본문 미기재'), null);
  assert.equal(parseEok(null), null);
});

const reit = (financials, history) => ({ reportDetail: { financials, dividends: { history } } });

test('navTotalWon: 자본총계(NAV) 원 단위', () => {
  const r = reit([{ label: '자본총계(NAV·연결)', value: '약 8,016억원' }], []);
  assert.equal(navTotalWon(r), 801600000000);
  assert.equal(navTotalWon(reit([{ label: '영업수익', value: '약 100억원' }], [])), null);
});

test('sharesOutstanding: 배당총액÷주당배당', () => {
  const r = reit([], [{ period: '제16기', perShare: '보통 182원 / 종류 411원', note: '배당총액 236.6억 · 기준일 2026.06.12' }]);
  assert.equal(sharesOutstanding(r), Math.round(23660000000 / 182));   // ≈ 130,000,000
});

test('sharesOutstanding: EPS 폴백(당기순이익÷주당순이익)', () => {
  const r = reit([
    { label: '당기순이익(반기)', value: '약 106억원' },
    { label: '주당순이익(반기)', value: '36원' },
  ], [{ period: '제14기', perShare: '123원', note: '기준일만 있고 배당총액 없음' }]);
  assert.equal(sharesOutstanding(r), Math.round(10600000000 / 36));
});

test('sharesOutstanding: 산정 불가면 null', () => {
  assert.equal(sharesOutstanding(reit([], [{ period: '제1기', perShare: '0원(무배당)', note: '' }])), null);
});

test('computePnav: 할인/할증 계산', () => {
  const r = reit(
    [{ label: '자본총계(NAV)', value: '약 8,016억원' }],
    [{ period: '제16기', perShare: '보통 182원', note: '배당총액 236.6억' }]);
  // shares≈130.0M, NAV=801.6B. price 5190 → mcap≈674.7B → P/NAV≈0.84
  const pn = computePnav(r, 5190);
  assert.equal(pn.shares, Math.round(23660000000 / 182));
  assert.ok(pn.pnav > 0.83 && pn.pnav < 0.86);
  assert.ok(pn.discountPct > 14 && pn.discountPct < 17);  // 약 16% 할인
  assert.equal(pn.navPerShare, Math.round(801600000000 / pn.shares));
});

test('computePnav: 데이터/가격 없으면 null', () => {
  const r = reit([{ label: '자본총계(NAV)', value: '약 8,016억원' }], [{ perShare: '182원', note: '배당총액 236.6억' }]);
  assert.equal(computePnav(r, 0), null);
  assert.equal(computePnav(reit([], []), 5000), null);
});
