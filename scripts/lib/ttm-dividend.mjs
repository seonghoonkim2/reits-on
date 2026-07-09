// 최근 12개월(TTM) 실제 주당배당금을 공시 배당 이력(reportDetail.dividends.history)에서 산출.
// 원칙: '추정(최근배당×횟수)'이 아니라 '실제 지급된 회차 합산'. 특별배당·미확정·무배당·누적·
// 종류주 등 실데이터의 지저분함을 명시적 플래그로 구분한다(임의 보정·은폐 없음).
//
// 반환: { ttmDps, freq, periodsUsed, quality, hasSpecial, approx, periods, note }
//   quality:
//     'actual'  — freq개 회차가 정상 확정, 특별배당 없음(가장 신뢰)
//     'special' — 창(window) 안에 특별배당/매각이익 포함(반복 아님 → 배지로 경고)
//     'partial' — 확정 회차가 freq개 미만(이력 부족)
//     'nodiv'   — 창 전체 무배당(0)
//     'none'    — 산정 불가(숫자 없음/이력 없음)

const RE_SPECIAL = /특별배당|매각이익|처분이익|자산\s*처분|처분\s*이익|일회성/;
const RE_PENDING = /미정|미확정|예정|TBD/i;
const RE_NODIV = /무배당|배당\s*없음/;
const RE_CUMUL = /누적/;

// perShare 문자열에서 '보통주(또는 단일) 주당 원' 정수 추출. 없으면 null.
export function parseWon(perShare) {
  if (perShare == null) return null;
  const s = String(perShare);
  if (RE_PENDING.test(s)) return null;
  if (RE_NODIV.test(s) || /(^|[^\d])0\s*원/.test(s)) return 0;
  // 종류주 병기 시 보통주 값을 취한다: "보통 182원 / 종류 411원"
  const common = s.match(/보통[^\d]*([\d,]+)\s*원/);
  if (common) return toInt(common[1]);
  // "약 96원" 등 근사치
  const approx = s.match(/약\s*([\d,]+)\s*원/);
  if (approx) return toInt(approx[1]);
  const m = s.match(/([\d,]+)\s*원/);
  return m ? toInt(m[1]) : null;
}
const toInt = (d) => { const n = parseInt(String(d).replace(/,/g, ''), 10); return Number.isFinite(n) ? n : null; };

// 배당 이력 1행을 분류.
function classify(h) {
  const ps = String(h && h.perShare != null ? h.perShare : '');
  const note = String(h && h.note != null ? h.note : '');
  const period = String(h && h.period != null ? h.period : '');
  if (RE_CUMUL.test(period) || RE_CUMUL.test(ps)) return { kind: 'cumulative' };
  if (RE_PENDING.test(ps)) return { kind: 'pending' };
  if (RE_NODIV.test(ps)) return { kind: 'nodiv', value: 0 };
  const v = parseWon(ps);
  if (v == null) return { kind: 'unknown' };                 // 예: "배당 실시"(금액 미상)
  const special = RE_SPECIAL.test(note) || RE_SPECIAL.test(ps);
  const approx = /약\s*[\d,]+\s*원/.test(ps);
  // 배당성향(payout ratio) 100% 초과 여부: 비고에 "배당성향 XXX%" 명시 시
  const pm = note.match(/배당성향[^\d]*([\d]+(?:\.\d+)?)\s*%/);
  const payoutOver100 = pm ? parseFloat(pm[1]) > 100 : false;
  return { kind: v === 0 ? 'nodiv' : 'regular', value: v, special, approx, payoutOver100, period };
}

// 결산배당 빈도: divMonths 개수(1/2/4). 방어적으로 1~4로 클램프.
const freqOf = (reit) => {
  const n = Array.isArray(reit.divMonths) ? reit.divMonths.length : 0;
  return Math.min(4, Math.max(1, n || 1));
};

// 회차 라벨에서 종료 연·월 추정: "제10기 (2025.05 결산)"→2025-05, "2025.07~12"→2025-12,
// "제16기 (2025)"→2025-12, "2026.1Q"→2026-03. 못 찾으면 null(신선도 판단 보류).
export function periodEndYM(period) {
  const s = String(period || '');
  const q = s.match(/(20\d{2})\s*[.\-]?\s*([1-4])\s*Q/i);
  if (q) return { y: +q[1], m: (+q[2]) * 3 };
  // 모든 YYYY.MM / YYYY-MM 중 가장 늦은 것("2025.07~12"의 12는 연도 생략이라 별도 처리)
  const range = s.match(/(20\d{2})\s*[.\-]\s*(\d{1,2})\s*[~‐-]\s*(\d{1,2})(?!\d)/);
  if (range) return { y: +range[1], m: Math.min(12, +range[3]) };
  const yms = [...s.matchAll(/(20\d{2})\s*[.\-]\s*(\d{1,2})(?!\d)/g)]
    .map((m) => ({ y: +m[1], m: Math.min(12, +m[2]) }))
    .filter((v) => v.m >= 1);
  if (yms.length) return yms.sort((a, b) => (a.y - b.y) || (a.m - b.m)).pop();
  const yr = s.match(/(20\d{2})/);
  if (yr) return { y: +yr[1], m: 12 };
  return null;
}
// 오늘로부터 몇 개월 전인지(대략, 월 단위)
const monthsAgo = (ym, now = new Date()) => (now.getFullYear() - ym.y) * 12 + (now.getMonth() + 1 - ym.m);

export function computeTtmDps(reit) {
  const freq = freqOf(reit);
  const hist = (reit.reportDetail && Array.isArray(reit.reportDetail.dividends?.history))
    ? reit.reportDetail.dividends.history : [];
  const entries = hist.map(classify);
  // 창에 쓸 수 있는 회차: 정상배당 or 무배당(0). 미확정/누적/미상은 건너뛴다(현재 미확정 회차 스킵 포함).
  const usable = entries.filter((e) => e.kind === 'regular' || e.kind === 'nodiv');
  const picked = usable.slice(0, freq);

  if (picked.length === 0) {
    return { ttmDps: null, freq, periodsUsed: 0, quality: 'none', hasSpecial: false, approx: false, periods: [], note: '배당 이력에서 금액 산정 불가' };
  }
  const ttmDps = picked.reduce((s, p) => s + (p.value || 0), 0);
  const hasSpecial = picked.some((p) => p.special);
  const approx = picked.some((p) => p.approx);
  const payoutOver100 = picked.some((p) => p.payoutOver100);
  const allZero = picked.every((p) => (p.value || 0) === 0);

  // 신선도: 최신 usable 회차의 종료월이 '회차 간격(12/freq개월)+4개월(공시 지연 버퍼)'보다
  // 오래됐으면 '최근 12개월' 창이 사실상 밀린 것 → stale 플래그(표시층에서 '갱신지연' 배지).
  let stale = false;
  const newestYM = periodEndYM(picked[0] && picked[0].period);
  if (newestYM && !allZero) {
    const limit = Math.ceil(12 / freq) + 4;
    stale = monthsAgo(newestYM) > limit;
  }

  let quality;
  if (allZero) quality = 'nodiv';
  else if (picked.length < freq) quality = 'partial';
  else if (hasSpecial) quality = 'special';
  else quality = 'actual';

  return {
    ttmDps,
    freq,
    periodsUsed: picked.length,
    quality,
    stale,
    hasSpecial,
    approx,
    payoutOver100,
    periods: picked.map((p) => p.period).filter(Boolean),
    note: quality === 'special' ? '특별배당/매각이익 포함(반복성 아님)'
      : quality === 'partial' ? `확정 회차 ${picked.length}/${freq}개(이력 부족)`
      : quality === 'nodiv' ? '최근 12개월 무배당'
      : approx ? '자본변동표 기준 근사치' : '공시 실적 합산',
  };
}

// 회차별 배당 시계열(차트용). 오래된→최근 순, 최대 maxPeriods개.
// 각 항목: { period(짧은 라벨), value(주당 원), special(특별배당), approx(근사치) }
// 미확정(pending)·누적(cumulative)·금액미상(unknown)은 제외한다.
export function dividendSeries(reit, maxPeriods = 8) {
  const hist = (reit.reportDetail && Array.isArray(reit.reportDetail.dividends?.history))
    ? reit.reportDetail.dividends.history : [];
  const rows = hist.map((h) => ({ c: classify(h), raw: h }))
    .filter(({ c }) => c.kind === 'regular' || c.kind === 'nodiv');
  return rows.slice(0, maxPeriods).reverse().map(({ c, raw }) => ({
    period: shortPeriod(raw && raw.period),
    value: c.value || 0,
    special: !!c.special,
    approx: !!c.approx,
  }));
}
function shortPeriod(p) {
  const s = String(p || '');
  const gi = s.match(/제\s*(\d+)\s*기/); if (gi) return gi[1] + '기';   // 제16기 → 16기
  const yr = s.match(/(20\d{2})/); if (yr) return "'" + yr[1].slice(2);  // 2025 → '25
  return s.slice(0, 6);
}

// 표시 로직(수익률·배지·경고)은 브라우저·빌드 공용 모듈에 있음. 재노출해 기존 import 유지.
export { ttmYield, isUnusualYield, dividendDisplay } from '../../assets/js/reit-metrics.mjs';
