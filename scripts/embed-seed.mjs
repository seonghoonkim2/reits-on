// data/*.json(단일 진실원천) → index.html의 임베드 seed-data 재생성.
// 임베드는 기존 프론트가 읽는 '평탄(flat)' 형태를 유지(런타임 동작 불변). facts·provenance는 data/reits.json에만.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const reitsDoc = JSON.parse(readFileSync(join(ROOT, 'data', 'reits.json'), 'utf8'));
const marketDoc = JSON.parse(readFileSync(join(ROOT, 'data', 'market.json'), 'utf8'));
const glossaryDoc = JSON.parse(readFileSync(join(ROOT, 'data', 'glossary.json'), 'utf8'));
const sourcesDoc = JSON.parse(readFileSync(join(ROOT, 'data', 'sources.json'), 'utf8'));

const flatReit = (r) => ({
  name: r.name, ticker: r.ticker, sector: r.sector, primary: r.primary,
  divMonths: r.divMonths,
  recentDiv: r.recentDiv && typeof r.recentDiv === 'object' ? r.recentDiv.value : (r.recentDiv ?? null),
  assetText: r.assetText, assetBn: r.assetBn,
  homepage: r.homepage, note: r.note, difficulty: r.difficulty, tags: r.tags,
  risk: r.risk ?? null,
});

const { retrievedAt, sourceUrl, sourceId, ...market } = marketDoc; // 임베드엔 출처 메타 제외(기존 형태 유지)

const seed = {
  reits: reitsDoc.reits.map(flatReit),
  market,
  glossary: glossaryDoc.terms,
  sources: sourcesDoc.sources,
};

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const re = /(<script id="seed-data" type="application\/json">)([\s\S]*?)(<\/script>)/;
if (!re.test(html)) { console.error('seed-data 블록 없음'); process.exit(1); }
const out = html.replace(re, `$1${JSON.stringify(seed)}$3`);
writeFileSync(join(ROOT, 'index.html'), out, 'utf8');
console.log(`임베드 갱신: reits ${seed.reits.length} · glossary ${seed.glossary.length} · sources ${seed.sources.length}`);
