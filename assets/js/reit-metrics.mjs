// 리츠 지표 표시 헬퍼(브라우저·빌드 공용, 순수 함수). 시세·배당의 '표시 로직'을 한 곳에서 관리.
// build-app.mjs가 이 파일을 index.html 런타임에 인라인 주입하고, 빌드 스크립트는 import 한다.

export const ttmYield = (ttmDps, price) =>
  (typeof ttmDps === 'number' && typeof price === 'number' && price > 0)
    ? Math.round((ttmDps / price) * 10000) / 100 : null;

// 이례적 고수익률(특별배당·주가급락·자본반환 신호). 표시하되 '확인 필요' 경고.
export const isUnusualYield = (y) => (typeof y === 'number' && y > 13);

// TTM 배당 표시 로직(배지·경고문구 일원화).
// f: { ttmDps, ttmQuality, ttmSpecial, ttmApprox, ttmPayoutOver100 }, price: 현재가
export function dividendDisplay(f, price) {
  const q = f && f.ttmQuality;
  if (q === 'nodiv') {
    return { show: true, isDiv: false, ttmDps: 0, yield: null, badge: '무배당', tone: 'warn',
      caveats: ['최근 12개월 배당이 없어요(적자·배당 여력 부족). 배당 재개 여부를 확인하세요.'] };
  }
  if (!f || q === 'none' || f.ttmDps == null) return { show: false };

  const y = ttmYield(f.ttmDps, price);
  const flags = [];
  if (f.ttmStale) flags.push('stale');
  if (f.ttmSpecial) flags.push('special');
  if (f.ttmPayoutOver100) flags.push('payout');
  if (q === 'partial') flags.push('partial');
  if (isUnusualYield(y) && !f.ttmSpecial) flags.push('unusual');
  if (f.ttmApprox) flags.push('approx');

  const CAVEAT = {
    stale: '가장 최근 확정 회차가 오래돼 최신 배당이 아직 반영되지 않았을 수 있어요(공시 확인 권장).',
    special: '최근 1년 배당에 일회성 특별배당(자산 처분이익 등)이 포함돼 반복 가능한 경상 수익률은 더 낮을 수 있어요.',
    payout: '배당성향이 100%를 넘어(순이익보다 많이 배당) 향후 배당 지속성에 유의하세요.',
    partial: '확정 배당 회차가 결산 횟수보다 적어, 실제 연배당보다 낮게 표시될 수 있어요.',
    unusual: '주가 하락이 반영돼 수익률이 이례적으로 높게 표시됩니다(주당 배당금 자체는 유지). 반드시 확인하세요.',
    approx: '배당금이 공시 자본변동표 기준 근사치예요.',
  };
  const BADGE = { stale: '갱신지연·확인', special: '특별배당 포함', payout: '배당성향 100%↑', partial: '이력 부족', unusual: '이례적·확인', approx: '근사치' };
  const TONE = { stale: 'warn', special: 'warn', payout: 'warn', unusual: 'warn', partial: 'muted', approx: 'muted' };
  const primary = ['stale', 'special', 'payout', 'partial', 'unusual', 'approx'].find((k) => flags.includes(k));

  return {
    show: true, isDiv: true, ttmDps: f.ttmDps, yield: y,
    badge: primary ? BADGE[primary] : '실적',
    tone: primary ? TONE[primary] : 'ok',
    caveats: flags.map((k) => CAVEAT[k]),
  };
}

// P/NAV 표시(런타임): 주당 장부 순자산(navPerShare)과 현재가로 배율·할인율 계산.
// null 또는 { pnav, discountPct, premium } (discountPct +면 할인, −면 할증)
export function navDisplay(navPerShare, price) {
  if (!(typeof navPerShare === 'number' && navPerShare > 0 && typeof price === 'number' && price > 0)) return null;
  const pnav = Math.round((price / navPerShare) * 100) / 100;
  const discountPct = Math.round((1 - price / navPerShare) * 1000) / 10;
  return { pnav, discountPct, premium: discountPct < 0 };
}

// 52주 밴드 내 현재가 위치. null 또는 { posPct, fromLowPct, offHighPct }
//   fromLowPct: 저점 대비 상승률(%), offHighPct: 고점 대비 하락률(% below 52w high, 표준 지표)
export function week52Position(price, low, high) {
  if (![price, low, high].every((v) => typeof v === 'number' && v > 0)) return null;
  if (high <= low) return null;
  const round1 = (v) => Math.round(v * 10) / 10;
  const posPct = Math.max(0, Math.min(100, Math.round((price - low) / (high - low) * 100)));
  return { posPct, fromLowPct: round1((price - low) / low * 100), offHighPct: round1((high - price) / high * 100) };
}
