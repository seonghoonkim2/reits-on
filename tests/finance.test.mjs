// node --test tests/finance.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampNum, annualizedDps, afterTaxNet, returnYieldPct,
  perMonthContribution, neededCapital, impliedPrice,
} from '../assets/js/finance.mjs';

test('clampNum: 유한·양수만, 그 외 0', () => {
  assert.equal(clampNum(1000), 1000);
  assert.equal(clampNum('5000'), 5000);
  assert.equal(clampNum(-3), 0);
  assert.equal(clampNum(0), 0);
  assert.equal(clampNum(NaN), 0);
  assert.equal(clampNum(null), 0);
  assert.equal(clampNum(undefined), 0);
  assert.equal(clampNum(Infinity), 0);
});

test('annualizedDps: 최근DPS×횟수, 결측은 null', () => {
  assert.equal(annualizedDps(73, 4), 292);
  assert.equal(annualizedDps(170, 2), 340);
  assert.equal(annualizedDps(null, 4), null);   // recentDiv 미표기
  assert.equal(annualizedDps(100, 0), null);
});

test('afterTaxNet: 세후 = 세전×(1−세율), 세율 가드', () => {
  assert.equal(afterTaxNet(1000000, 0), 1000000);
  assert.equal(afterTaxNet(1000000, 0.154), 846000);
  assert.equal(Math.round(afterTaxNet(700000, 0.099)), 630700);
  assert.equal(afterTaxNet(1000, 1.5), 1000);    // 비정상 세율 → 0% 처리
  assert.equal(afterTaxNet(NaN, 0.1), 0);
});

test('returnYieldPct: 0.1% 반올림, base 0/음수면 null', () => {
  assert.equal(returnYieldPct(630700, 10000000), 6.3);
  assert.equal(returnYieldPct(1000, 0), null);
  assert.equal(returnYieldPct(1000, -5), null);
});

test('perMonthContribution: 투자금×수익률/횟수, 비정상은 0', () => {
  assert.equal(perMonthContribution(12000000, 4, 0.07), (12000000 * 0.07) / 4);
  assert.equal(perMonthContribution(0, 4, 0.07), 0);
  assert.equal(perMonthContribution(1000, 0, 0.07), 0);
  assert.equal(perMonthContribution(1000, 4, 0), 0);
});

test('neededCapital: 목표 월배당(세후)→필요 투자금', () => {
  // 월 50만(세후), 수익률 7%, 세율 9.9% → 세전연=6,000,000/0.901, 자본=그/0.07
  const v = neededCapital(500000, 0.07, 0.099);
  assert.equal(Math.round(v), Math.round((500000 * 12 / 0.901) / 0.07));
  assert.equal(neededCapital(0, 0.07, 0.099), null);
  assert.equal(neededCapital(500000, 0, 0.099), null);
});

test('impliedPrice: 연DPS/목표수익률', () => {
  assert.equal(Math.round(impliedPrice(350, 0.07)), 5000);
  assert.equal(impliedPrice(350, 0), null);
  assert.equal(impliedPrice(null, 0.07), null);
});

test('세전/세후 분리 — 추정·연환산·사용자입력 혼동 방지(회귀)', () => {
  const gross = 10000000 * 0.07;            // 사용자 입력 투자금 × 가정 수익률
  assert.equal(Math.round(gross), 700000);  // 부동소수 → 표시 전 반올림(UI와 동일)
  assert.equal(Math.round(afterTaxNet(gross, 0.099)), 630700);   // 세후
  assert.equal(Math.round(afterTaxNet(gross, 0.154)), 592200);   // 일반세
});
