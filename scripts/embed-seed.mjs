// data/*.json(단일 진실원천) → index.html의 임베드 seed-data 재생성.
// 임베드는 기존 프론트가 읽는 '평탄(flat)' 형태를 유지(런타임 동작 불변). facts·provenance는 data/reits.json에만.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computeTtmDps, dividendSeries } from './lib/ttm-dividend.mjs';
import { navTotalWon, sharesOutstanding } from './lib/nav.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const reitsDoc = JSON.parse(readFileSync(join(ROOT, 'data', 'reits.json'), 'utf8'));
const marketDoc = JSON.parse(readFileSync(join(ROOT, 'data', 'market.json'), 'utf8'));
const glossaryDoc = JSON.parse(readFileSync(join(ROOT, 'data', 'glossary.json'), 'utf8'));
const sourcesDoc = JSON.parse(readFileSync(join(ROOT, 'data', 'sources.json'), 'utf8'));
let changesDoc = { events: [] };
try { changesDoc = JSON.parse(readFileSync(join(ROOT, 'data', 'changes.json'), 'utf8')); } catch { /* 최초 빌드 */ }

// 규칙기반 건강 신호(홈 목록 점 표시용) — build-pages.mjs proDashboard 로직과 동일 기준
const _p = (s) => { const m = String(s ?? '').replace(/,/g, '').match(/(-?\d+(?:\.\d+)?)\s*%/); return m ? parseFloat(m[1]) : null; };
const _fv = (arr, kw) => { if (!Array.isArray(arr)) return null; const re = new RegExp(kw); const it = arr.find((x) => x && re.test(x.label || '')); return it ? it.value : null; };
function ltvOf(r) {
  const f = r.facts || {};
  if (f.ltv && f.ltv.status === 'actual' && typeof f.ltv.value === 'number' && f.ltv.value <= 100) return f.ltv.value;
  const s = r.reportDetail && _fv(r.reportDetail.debt && r.reportDetail.debt.summary, 'LTV|레버리지');
  if (!s || /미기재|미명시|없음|해당없음|참고|부채비율/.test(String(s))) return null;
  const p = _p(s); return (p != null && p > 0 && p <= 100) ? p : null;
}
function healthLevel(r) {
  let lv = 'ok';
  if (r.risk) lv = r.risk.level === 'high' ? 'risk' : 'warn';
  const ltv = ltvOf(r);
  if (ltv != null) { if (ltv >= 65) lv = lv === 'risk' ? 'risk' : 'warn'; else if (ltv >= 55 && lv === 'ok') lv = 'warn'; }
  const d = r.reportDetail || {};
  const fixed = _p(_fv(d.debt && d.debt.summary, '고정금리') || (r.facts && r.facts.debtFixedRatio && r.facts.debtFixedRatio.display));
  if (fixed != null && fixed <= 20 && lv === 'ok') lv = 'warn';
  const fin = (d.financials || []).map((x) => String(x.label) + ' ' + String(x.value)).join(' ');
  if (/적자|순손실/.test(fin) && lv !== 'risk') lv = 'warn';
  return lv;
}

const flatReit = (r) => {
  const mkt = r.market || {};
  const ttm = computeTtmDps(r);   // 공시 배당 이력 기반 최근 12개월 실배당(추정 아님)
  const nav = navTotalWon(r), sh = sharesOutstanding(r);   // 장부 순자산·발행주식수
  const navPerShare = (nav && sh) ? Math.round(nav / sh) : null;
  return {
    name: r.name, ticker: r.ticker, sector: r.sector, primary: r.primary,
    divMonths: r.divMonths,
    recentDiv: r.recentDiv && typeof r.recentDiv === 'object' ? r.recentDiv.value : (r.recentDiv ?? null),
    assetText: r.assetText, assetBn: r.assetBn,
    homepage: r.homepage, note: r.note, difficulty: r.difficulty, tags: r.tags,
    risk: r.risk ?? null,
    health: healthLevel(r),
    // 일일 자동 갱신 시세 스냅샷(빌드 시점) — 런타임 hydrateFromApi가 최신값으로 다시 덮어씀
    price: mkt.price ?? null,
    changePct: mkt.changePct ?? null,
    priceAsOf: mkt.priceAsOf ?? null,
    yieldPriceBasis: mkt.yieldPriceBasis ?? null,
    annualDpsEst: mkt.annualDpsEst ?? null,
    week52High: mkt.week52High ?? null,
    week52Low: mkt.week52Low ?? null,
    // 실배당수익률(TTM): ttmDps=최근 12개월 실지급 주당배당 합 · ttmQuality=actual/special/partial/nodiv/none
    ttmDps: ttm.ttmDps,
    ttmQuality: ttm.quality,
    ttmSpecial: ttm.hasSpecial,
    ttmApprox: ttm.approx,
    ttmPayoutOver100: ttm.payoutOver100,
    // P/NAV용 장부 주당순자산(가격 무관·런타임에서 현재가로 배율 계산). 산정 불가면 null.
    navPerShare,
    // 회차별 배당 시계열(차트용): [{period,value,special,approx}] 오래된→최근
    divHistory: dividendSeries(r),
  };
};

const { retrievedAt, sourceUrl, sourceId, ...market } = marketDoc; // 임베드엔 출처 메타 제외(기존 형태 유지)

const seed = {
  reits: reitsDoc.reits.map(flatReit),
  market,
  glossary: glossaryDoc.terms,
  sources: sourcesDoc.sources,
  changes: (changesDoc.events || []).slice(0, 20),   // 최근 변화(홈·개인화용)
};

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const re = /(<script id="seed-data" type="application\/json">)([\s\S]*?)(<\/script>)/;
if (!re.test(html)) { console.error('seed-data 블록 없음'); process.exit(1); }
const out = html.replace(re, `$1${JSON.stringify(seed)}$3`);
writeFileSync(join(ROOT, 'index.html'), out, 'utf8');
console.log(`임베드 갱신: reits ${seed.reits.length} · glossary ${seed.glossary.length} · sources ${seed.sources.length}`);
