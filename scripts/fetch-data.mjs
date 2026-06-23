// 매일 백엔드 API(Cloudflare Worker)에서 시세·시장 집계를 받아 data/*.json에 병합한다.
// 원칙:
//  - 네트워크 실패·이상 응답이면 파일을 건드리지 않고 정상 종료(exit 0) → 빌드는 기존 데이터로 계속.
//  - 정성 데이터·provenance(facts/reportDetail/sourceUrl 등)는 절대 덮어쓰지 않는다. 시세 스냅샷은 r.market 하위에만.
//  - 실질 변경이 없으면(타임스탬프 제외) 쓰지 않는다 → 무의미한 일일 커밋 방지.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = (process.env.API_BASE || 'https://reits-on-api.modelter.workers.dev').replace(/\/$/, '');
const NOW = new Date().toISOString();
const num = (v) => (typeof v === 'number' && isFinite(v)) ? v : null;
const dataPath = (p) => join(ROOT, 'data', p);
const readJSON = (p) => JSON.parse(readFileSync(dataPath(p), 'utf8'));
const writeJSON = (p, o) => writeFileSync(dataPath(p), JSON.stringify(o, null, 2) + '\n', 'utf8');
// retrievedAt(타임스탬프) 차이는 무시하고 실질 내용만 비교
const eqIgnoringTs = (a, b) => {
  const strip = (o) => JSON.stringify(o, (k, v) => k === 'retrievedAt' ? undefined : v);
  return strip(a) === strip(b);
};

async function getJSON(path, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(API + path, { signal: ctrl.signal, headers: { accept: 'application/json' } });
      clearTimeout(timer);
      if (res.ok) return await res.json();
      console.log(`  ! ${path} HTTP ${res.status}`);
    } catch (e) {
      console.log(`  ! ${path} 시도 ${i + 1}/${tries} 실패: ${e.message}`);
    }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  return null;
}

console.log(`데이터 갱신 시작 · ${API}`);
const [mk, rl] = await Promise.all([getJSON('/v1/market'), getJSON('/v1/reits')]);
let wrote = false;

// 1) data/market.json — 시장 집계(KAREIT 동일 출처) 수치 갱신, 출처 메타(sourceUrl/sourceId)는 보존
if (mk && num(mk.listedReits) != null && num(mk.totalAumTn) != null) {
  const orig = readJSON('market.json');
  const m = JSON.parse(JSON.stringify(orig));
  const set = (k, v) => { if (v != null) m[k] = v; };
  set('asOf', mk.asOfDate || mk.asOf || m.asOf);
  set('totalReits', num(mk.totalReits));
  set('totalAumTn', num(mk.totalAumTn));
  set('listedReits', num(mk.listedReits));
  set('listedMarketCapTn', num(mk.listedMarketCapTn));
  set('listedAumTn', num(mk.listedAumTn));
  set('listedDividendYieldPaidInCapital', num(mk.listedDividendYieldPaidInCapital));
  set('listedDividendYieldPriceBasis', num(mk.listedDividendYieldPriceBasis));
  if (Array.isArray(mk.sectorAum) && mk.sectorAum.length) m.sectorAum = mk.sectorAum;
  if (Array.isArray(mk.growth) && mk.growth.length) m.growth = mk.growth;
  m.retrievedAt = NOW;
  if (eqIgnoringTs(m, orig)) {
    console.log('· market.json 실질 변경 없음 — 유지');
  } else {
    writeJSON('market.json', m);
    wrote = true;
    console.log(`✓ market.json 갱신 (asOf ${m.asOf} · 상장 ${m.listedReits}개 · 평균수익률 ${m.listedDividendYieldPriceBasis}%)`);
  }
} else {
  console.log('· market 응답 없음/이상 — market.json 유지');
}

// 2) data/reits.json — 종목별 시세 스냅샷을 r.market 에 병합(정성·provenance 불변)
if (rl && Array.isArray(rl.reits) && rl.reits.length >= 20) {
  const orig = readJSON('reits.json');
  const doc = JSON.parse(JSON.stringify(orig));
  const byT = {};
  rl.reits.forEach((x) => { if (x && x.ticker) byT[x.ticker] = x; });
  let matched = 0, withPrice = 0;
  for (const r of doc.reits) {
    const live = byT[r.ticker];
    if (!live) continue;
    matched++;
    const snap = {};
    if (num(live.price) != null) { snap.price = num(live.price); withPrice++; }
    if (num(live.changePct) != null) snap.changePct = num(live.changePct);
    if (live.priceAsOf) snap.priceAsOf = String(live.priceAsOf);
    if (num(live.marketCap) != null) snap.marketCap = num(live.marketCap);
    if (num(live.annualDpsEst) != null) snap.annualDpsEst = num(live.annualDpsEst);
    if (num(live.yieldPriceBasis) != null) snap.yieldPriceBasis = num(live.yieldPriceBasis);
    if (Object.keys(snap).length) {
      snap.retrievedAt = NOW;
      snap.sourceUrl = API + '/v1/reits';
      snap.sourceId = 'reits-on-api';
      r.market = snap;
    }
  }
  if (matched >= 10) {
    doc.retrievedAt = NOW;
    if (eqIgnoringTs(doc, orig)) {
      console.log(`· reits.json 실질 변경 없음 — 유지 (매칭 ${matched}/${doc.reits.length})`);
    } else {
      writeJSON('reits.json', doc);
      wrote = true;
      console.log(`✓ reits.json 갱신 (매칭 ${matched}/${doc.reits.length}개 · 시세 보유 ${withPrice}개)`);
    }
  } else {
    console.log(`· 매칭 ${matched}개(<10) — reits.json 유지`);
  }
} else {
  console.log('· reits 응답 없음/부족 — reits.json 유지');
}

console.log(wrote ? '데이터 갱신 완료(변경 있음).' : '데이터 변경 없음 — 기존 데이터로 빌드 진행.');
process.exit(0);
