// P/NAV(주가순자산배율) 산출 — '지금 싸냐'에 대한 리츠 표준 지표.
// 근거는 공시 재무(reportDetail.financials)의 '자본총계(NAV)'와,
// 발행주식수(배당총액÷주당배당 또는 당기순이익÷주당순이익로 역산).
// 감정가 기준이 아닌 '장부 순자산' 기준(보수적)이며, 감정 공정가치가 장부보다 크면
// 실제 할인폭은 더 클 수 있음을 표시측에서 caveat으로 안내한다.

// "약 1조 1,620억원" / "약 8,016억원" / "약 1.11조원" → 억(원) 단위 숫자
export function parseEok(str) {
  if (str == null) return null;
  const s = String(str).replace(/,/g, '');
  let eok = 0; let matched = false;
  const jo = s.match(/([\d.]+)\s*조/);
  if (jo) { eok += parseFloat(jo[1]) * 10000; matched = true; }
  const rest = jo ? s.slice(s.indexOf(jo[0]) + jo[0].length) : s;
  const e = rest.match(/([\d.]+)\s*억/);
  if (e) { eok += parseFloat(e[1]); matched = true; }
  return matched ? Math.round(eok * 100) / 100 : null;
}

// 주당 원 정수(보통주 우선). ttm-dividend.parseWon과 동일 규칙의 경량판.
function won(s) {
  if (s == null) return null;
  const t = String(s);
  const c = t.match(/보통[^\d]*([\d,]+)\s*원/); if (c) return toInt(c[1]);
  const a = t.match(/약\s*([\d,]+)\s*원/); if (a) return toInt(a[1]);
  const m = t.match(/([\d,]+)\s*원/); return m ? toInt(m[1]) : null;
}
const toInt = (d) => { const n = parseInt(String(d).replace(/,/g, ''), 10); return Number.isFinite(n) ? n : null; };
const finItem = (rd, re) => (rd && Array.isArray(rd.financials) ? rd.financials.find((f) => re.test(f.label || '')) : null);

// 자본총계(NAV) 원. 없으면 null.
export function navTotalWon(reit) {
  const rd = reit.reportDetail;
  const it = finItem(rd, /자본총계|순자산/);
  const eok = it ? parseEok(it.value) : null;
  return eok != null ? Math.round(eok * 1e8) : null;
}

// 발행주식수 역산 후보를 모은다: ⓞ 확정공시 배당총액÷주당(가장 신선) · ① 공시이력 배당총액÷주당 ·
// ② 당기순이익÷EPS. 각 {n, src}. 서로 다른 시점이므로 교차검증의 재료가 된다.
// confirmed: dividends-confirmed의 해당 종목 최신 {totalWon, perShare}(선택).
export function shareEstimates(reit, confirmed) {
  const rd = reit.reportDetail || {};
  const ests = [];
  if (confirmed && confirmed.totalWon > 0 && confirmed.perShare > 0) {
    const n = Math.round(confirmed.totalWon / confirmed.perShare);
    if (n > 0) ests.push({ n, src: 'confirmed' });
  }
  const hist = (rd.dividends && Array.isArray(rd.dividends.history)) ? rd.dividends.history : [];
  for (const h of hist) {
    const ps = won(h && h.perShare);
    const tot = String(h && h.note || '').match(/(?:배당총액|총)\s*([\d,.]+)\s*억/);
    if (ps && ps > 0 && tot) {
      const n = Math.round(parseFloat(tot[1].replace(/,/g, '')) * 1e8 / ps);
      if (n > 0) ests.push({ n, src: 'history:' + (h.period || '') });
    }
  }
  const ni = finItem(rd, /당기순이익/);
  const eps = finItem(rd, /주당순이익|EPS/);
  const niWon = ni ? parseEok(ni.value) : null;   // 억
  const epsWon = eps ? won(eps.value) : null;
  if (niWon != null && epsWon && epsWon > 0) {
    const n = Math.round(niWon * 1e8 / epsWon);
    if (n > 0) ests.push({ n, src: 'eps' });
  }
  return ests;
}

// 발행주식수: 배당총액 기반 후보(확정공시·공시이력)를 우선 교차검증한다. 2개 이상인데 서로 7% 초과
// 벌어지면(유상증자 등으로 NAV 시점과 주식수 시점이 어긋난 것) 산정 보류(null). EPS 역산은 연결/별도
// 순이익·일회성 손익으로 흔들려 신뢰가 낮으므로, 배당기반 후보가 하나라도 있으면 교차검증에서 제외하고
// 배당기반이 전무할 때만 최후 폴백으로 쓴다.
export function sharesOutstanding(reit, confirmed) {
  const ests = shareEstimates(reit, confirmed);
  if (!ests.length) return null;
  const divBased = ests.filter((e) => e.src === 'confirmed' || e.src.startsWith('history'));
  if (divBased.length) {
    if (divBased.length >= 2) {
      const ns = divBased.map((e) => e.n);
      const spread = (Math.max(...ns) - Math.min(...ns)) / Math.min(...ns);
      if (spread > 0.07) return null;   // 증자 의심 → P/NAV 신뢰 불가
    }
    return (divBased.find((e) => e.src === 'confirmed') || divBased[0]).n;   // 확정공시 우선
  }
  return ests[0].n;   // EPS 폴백(단일 소스)
}

// P/NAV 계산. price(현재가) 필요. confirmed(선택) = 해당 종목 {totalWon, perShare}. 반환 null 또는
//   { pnav, discountPct, navTotalEok, shares, marketCapEok, navPerShare }
export function computePnav(reit, price, confirmed) {
  if (typeof price !== 'number' || price <= 0) return null;
  const nav = navTotalWon(reit);
  const sh = sharesOutstanding(reit, confirmed);
  if (!nav || !sh) return null;
  const marketCap = sh * price;
  const pnav = Math.round((marketCap / nav) * 100) / 100;
  return {
    pnav,
    discountPct: Math.round((1 - marketCap / nav) * 1000) / 10,  // +면 할인, −면 할증
    navTotalEok: Math.round(nav / 1e8),
    shares: sh,
    marketCapEok: Math.round(marketCap / 1e8),
    navPerShare: Math.round(nav / sh),
  };
}
