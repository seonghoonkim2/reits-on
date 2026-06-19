// 순수 금융 계산 함수(부수효과·DOM 없음). node로 단위테스트하고,
// scripts/build-app.mjs가 index.html의 FINANCE_INLINE 블록에 주입한다(브라우저는 classic script 유지).
// 절대원칙: 입력이 비정상이면 0/null로 안전 처리, 음수·NaN 방어.

// 숫자 정규화: 유한·양수만 통과, 그 외 0.
export const clampNum = (v) => { const n = Number(v); return isFinite(n) && n > 0 ? n : 0; };

// 연환산 DPS = 최근 1회 DPS × 연간 횟수 (단순 추정; 특별배당 미구분)
export const annualizedDps = (recentDiv, freqLen) => {
  const d = clampNum(recentDiv), f = clampNum(freqLen);
  return d > 0 && f > 0 ? d * f : null;
};

// 세후 = 세전 × (1 − 세율). 세율은 0~1.
export const afterTaxNet = (gross, taxRate) => {
  const g = Number(gross); const t = Number(taxRate);
  if (!isFinite(g)) return 0;
  const tt = isFinite(t) && t >= 0 && t < 1 ? t : 0;
  return g * (1 - tt);
};

// 투자금 대비 수익률(%) = 순배당 / 기준액 × 100
export const returnYieldPct = (net, base) => {
  const n = Number(net), b = clampNum(base);
  return b > 0 && isFinite(n) ? Math.round((n / b) * 1000) / 10 : null;
};

// 배당월 1개월당 배분액 = 투자금 × 가정수익률 / 연간 배당횟수
export const perMonthContribution = (amount, freqLen, yieldFraction) => {
  const a = clampNum(amount), f = clampNum(freqLen), y = Number(yieldFraction);
  if (!(a > 0) || !(f > 0) || !isFinite(y) || y <= 0) return 0;
  return (a * y) / f;
};

// 목표 월배당(세후)에 필요한 투자금
//   세전연 = 세후연 / (1−세율);  필요투자금 = 세전연 / 가정수익률
export const neededCapital = (targetMonthlyNet, yieldFraction, taxRate) => {
  const m = clampNum(targetMonthlyNet), y = Number(yieldFraction);
  const t = Number(taxRate); const net = isFinite(t) && t >= 0 && t < 1 ? 1 - t : 1;
  if (!(m > 0) || !isFinite(y) || y <= 0 || net <= 0) return null;
  const grossAnnual = (m * 12) / net;
  return grossAnnual / y;
};

// 목표수익률 기준 가격 = 연 DPS / 목표수익률(소수)
export const impliedPrice = (annualDps, targetYieldFraction) => {
  const d = clampNum(annualDps), y = Number(targetYieldFraction);
  return d > 0 && isFinite(y) && y > 0 ? d / y : null;
};
