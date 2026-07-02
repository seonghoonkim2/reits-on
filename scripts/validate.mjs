// 의존성 없는 데이터 검증기. data/reits.json의 구조·provenance·도메인 규칙을 점검한다.
// 실패 시 exit 1 (GitHub Actions에서 잘못된 데이터가 main에 자동 반영되지 않도록).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseWon, computeTtmDps } from './lib/ttm-dividend.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATUS = ['actual', 'estimated', 'annualized', 'user_input', 'stale', 'unavailable'];
const errors = [];
const warns = [];
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

function checkProv(path, p) {
  if (typeof p !== 'object' || p === null) { errors.push(`${path}: provenance 객체가 아님`); return; }
  if (!STATUS.includes(p.status)) errors.push(`${path}.status="${p.status}" 허용값 아님(${STATUS.join('/')})`);
  if (p.asOf != null && !isDate(p.asOf)) errors.push(`${path}.asOf 형식 오류(YYYY-MM-DD): ${p.asOf}`);
  // 절대원칙: actual/estimated/annualized면 value와 출처가 있어야 함(미확인 수치 금지)
  if (['actual', 'estimated', 'annualized'].includes(p.status)) {
    if (p.value == null) errors.push(`${path}: status=${p.status}인데 value=null (미확인 수치 금지)`);
    if (!p.sourceUrl && !p.sourceId) errors.push(`${path}: status=${p.status}인데 sourceUrl/sourceId 없음`);
    if (!p.asOf) warns.push(`${path}: status=${p.status}인데 asOf 없음(권장)`);
  }
  // unavailable이면 value는 null이어야 함(0으로 표시 금지)
  if (p.status === 'unavailable' && p.value != null) errors.push(`${path}: unavailable인데 value=${p.value} (null이어야 함)`);
}

const doc = JSON.parse(readFileSync(join(ROOT, 'data', 'reits.json'), 'utf8'));
if (!isDate(doc.asOf)) errors.push('루트 asOf 형식 오류');
if (!Array.isArray(doc.reits) || !doc.reits.length) errors.push('reits 배열 비어있음');

const tickers = new Set();
for (const r of doc.reits || []) {
  const id = r.ticker || r.name || '?';
  if (!r.name) errors.push(`${id}: name 없음`);
  if (!/^[0-9A-Z]{6}$/.test(r.ticker || '')) errors.push(`${id}: ticker 형식 오류(6자리 영숫자)`);
  if (tickers.has(r.ticker)) errors.push(`${id}: ticker 중복`);
  tickers.add(r.ticker);
  if (!Array.isArray(r.sector) || !r.sector.length) errors.push(`${id}: sector 비어있음`);
  if (!Array.isArray(r.divMonths) || r.divMonths.some((m) => m < 1 || m > 12)) errors.push(`${id}: divMonths 범위 오류`);
  if (!['쉬움', '보통', '상세확인'].includes(r.difficulty)) errors.push(`${id}: difficulty 허용값 아님`);
  checkProv(`${id}.recentDiv`, r.recentDiv);
  if (r.facts && typeof r.facts === 'object') {
    for (const [k, v] of Object.entries(r.facts)) checkProv(`${id}.facts.${k}`, v);
  } else errors.push(`${id}: facts 없음`);

  // 교차검증: recentDiv(KAREIT 표) vs 최신 공시 배당(reportDetail) 불일치 감지 → 갱신 검토 경고
  const hist = r.reportDetail && Array.isArray(r.reportDetail.dividends?.history) ? r.reportDetail.dividends.history : [];
  const latest = hist.map((h) => parseWon(h && h.perShare)).find((v) => v != null && v > 0);
  const rd = r.recentDiv && typeof r.recentDiv === 'object' ? r.recentDiv.value : r.recentDiv;
  if (latest != null && typeof rd === 'number' && rd > 0) {
    const diff = Math.abs(latest - rd) / rd;
    if (diff > 0.2) warns.push(`${id}: recentDiv(${rd}) vs 최신 공시배당(${latest}) ${Math.round(diff * 100)}% 차이 — 갱신 검토`);
  }
  // TTM 산정 결과 sanity: 이력이 있는데 none이면(파싱 실패 가능) 경고
  if (hist.length && computeTtmDps(r).quality === 'none') warns.push(`${id}: 배당 이력이 있으나 TTM 산정 불가(포맷 확인)`);
}

// facts 기준일 노후 경고(15개월 초과) — provenance 신선도 유지
const STALE_MONTHS = 15;
const now = new Date();
let staleCount = 0;
for (const r of doc.reits || []) {
  for (const [k, v] of Object.entries(r.facts || {})) {
    if (v && isDate(v.asOf) && v.status !== 'unavailable') {
      const ageMon = (now - new Date(v.asOf + 'T00:00:00Z')) / (1000 * 60 * 60 * 24 * 30.4);
      if (ageMon > STALE_MONTHS) staleCount++;
    }
  }
}
if (staleCount) warns.push(`facts 기준일 ${STALE_MONTHS}개월 초과 ${staleCount}건 — 최신 투자보고서로 갱신 검토`);

console.log(`검증: 종목 ${doc.reits?.length ?? 0}개 · 오류 ${errors.length} · 경고 ${warns.length}`);
warns.forEach((w) => console.log('  ⚠ ' + w));
if (errors.length) { errors.forEach((e) => console.log('  ✗ ' + e)); process.exit(1); }
console.log('✓ 통과');
