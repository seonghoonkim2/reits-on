// 1회성: index.html의 임베드 seed-data를 정규 data/*.json으로 추출하고
// 종목별 facts(provenance 포함) 스캐폴드를 부착한다.
// 이후 data/reits.json이 단일 진실원천이 되고, embed-seed.mjs가 index.html 임베드를 재생성한다.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const m = html.match(/<script id="seed-data" type="application\/json">([\s\S]*?)<\/script>/);
if (!m) { console.error('seed-data 없음'); process.exit(1); }
const seed = JSON.parse(m[1]);

const KAREIT = 'https://www.kareit.or.kr/invest/page2.php';
const prov = (value, unit, status, asOf, sourceUrl, sourceId, note = null, display = null) =>
  ({ value: value ?? null, unit: unit ?? null, display: display ?? null, asOf: asOf ?? null, status, sourceUrl: sourceUrl ?? null, sourceId: sourceId ?? null, note });

// 정량 정성 팩트: 보유한 값(자산총계)만 actual, 나머지는 unavailable(운용 실무자가 data/reits.json에서 채움)
function buildFacts(r) {
  return {
    aum: prov(r.assetBn, '억원', 'actual', '2025-12-31', KAREIT, 'kareit-2025', '한국리츠협회 공개표 기준 자산총계(연결 AUM과 다를 수 있음)', r.assetText),
    ltv: prov(null, '%', 'unavailable', null, null, null, '투자보고서/공시에서 확인 후 입력'),
    wale: prov(null, '년', 'unavailable', null, null, null, '가중평균 잔여임대차기간 — 투자보고서 확인 후 입력'),
    occupancy: prov(null, '%', 'unavailable', null, null, null, '공실률/임대율 — 투자보고서 확인 후 입력'),
    debtFixedRatio: prov(null, '%', 'unavailable', null, null, null, '고정금리 비중'),
    debtMaturity12m: prov(null, '%', 'unavailable', null, null, null, '향후 12개월 내 만기 비중'),
    topTenant: prov(null, null, 'unavailable', null, null, null, '주요 임차인'),
    tenantConcentration: prov(null, '%', 'unavailable', null, null, null, '상위 임차인 집중도'),
  };
}

const reits = seed.reits.map((r) => ({
  name: r.name, ticker: r.ticker, sector: r.sector, primary: r.primary,
  divMonths: r.divMonths,
  recentDiv: prov(r.recentDiv, '원', r.recentDiv == null ? 'unavailable' : 'actual', '2025-12-31', KAREIT, 'kareit-2025', '최근 1회 주당배당금(공시 확인 필요)'),
  payMonths: prov(null, null, 'unavailable', null, null, null, '실제 지급월 이력 — 데이터 미확보(배당기준월과 다름)'),
  assetText: r.assetText, assetBn: r.assetBn,
  homepage: r.homepage, note: r.note, difficulty: r.difficulty, tags: r.tags,
  facts: buildFacts(r),
}));

const reitsDoc = {
  asOf: '2026-06-19',
  baselineNote: '개별 종목 자산총계·최근배당금은 한국리츠협회 공개표(2025.12 투자보고서 기준)에서 입력. 시세·정성팩트(LTV·WALE 등)는 status로 구분.',
  sourceDefault: { sourceUrl: KAREIT, sourceId: 'kareit-2025' },
  reits,
};

mkdirSync(join(ROOT, 'data'), { recursive: true });
writeFileSync(join(ROOT, 'data', 'reits.json'), JSON.stringify(reitsDoc, null, 2), 'utf8');
writeFileSync(join(ROOT, 'data', 'market.json'), JSON.stringify({ asOf: seed.market.asOf, retrievedAt: null, sourceUrl: KAREIT, sourceId: 'kareit-2025', ...seed.market }, null, 2), 'utf8');
writeFileSync(join(ROOT, 'data', 'glossary.json'), JSON.stringify({ terms: seed.glossary }, null, 2), 'utf8');
writeFileSync(join(ROOT, 'data', 'sources.json'), JSON.stringify({ sources: seed.sources }, null, 2), 'utf8');

console.log(`추출 완료: reits ${reits.length} · market · glossary ${seed.glossary.length} · sources ${seed.sources.length}`);
