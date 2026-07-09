// 종목별 카카오/트위터 공유 카드(OG 이미지) 자동생성. '3숫자'가 박힌 카드 = 공유가 곧 마케팅.
// @resvg/resvg-js로 SVG→PNG. 한글은 시스템 폰트(fonts-nanum) 사용. 의존성 없으면 조용히 건너뛴다.
// churn 제어: 소스 SVG 해시가 바뀔 때만 PNG를 다시 쓴다(data/og-hashes.json).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { dividendDisplay, navDisplay } from '../assets/js/reit-metrics.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'seonghoonkim2.github.io/reits-on';

let Resvg;
try { ({ Resvg } = await import('@resvg/resvg-js')); }
catch { console.log('· @resvg/resvg-js 없음 — OG 이미지 생성 건너뜀(npm ci 필요)'); process.exit(0); }

// ---- 데이터 로드(빌드 seed + 인프라) ----
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const seed = JSON.parse(html.match(/<script id="seed-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
let INFRA = [];
try { INFRA = (JSON.parse(readFileSync(join(ROOT, 'data', 'infra.json'), 'utf8')).infra) || []; } catch { /* skip */ }
const NOW_MONTH = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', month: 'numeric' }).format(new Date()));
const nextDivMonth = (dm) => { if (!Array.isArray(dm) || !dm.length) return null; const s = dm.slice().sort((a, b) => a - b); return s.find((m) => m >= NOW_MONTH) ?? s[0]; };
const fmt = (n) => Number(n).toLocaleString('ko-KR');
const xml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (t) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[t]));

const FONT = 'NanumGothic, NanumGothicOTF, sans-serif';
// 3칸 스탯 카드 SVG 조각
function statCell(x, label, value, sub, tone) {
  const col = tone === 'warn' ? '#9a6700' : '#172033';
  return `<g transform="translate(${x},330)">
    <rect width="336" height="200" rx="18" fill="#f7f9fe" stroke="#e5e9f2"/>
    <text x="24" y="46" font-family="${FONT}" font-size="24" font-weight="700" fill="#5a647b">${xml(label)}</text>
    <text x="24" y="118" font-family="${FONT}" font-size="60" font-weight="800" fill="${col}">${xml(value)}</text>
    <text x="24" y="164" font-family="${FONT}" font-size="24" font-weight="600" fill="#5a647b">${xml(sub || '')}</text>
  </g>`;
}
function card(name, sector, cells, footRight) {
  const nm = name.length > 13 ? name : name;
  const nameSize = name.length > 12 ? 54 : 64;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#ffffff"/>
  <rect width="1200" height="12" fill="#3254ff"/>
  <g transform="translate(72,86)">
    <rect width="52" height="52" rx="14" fill="#3254ff"/>
    <text x="26" y="37" font-family="${FONT}" font-size="30" font-weight="800" fill="#ffffff" text-anchor="middle">R</text>
    <text x="70" y="36" font-family="${FONT}" font-size="28" font-weight="800" fill="#172033">리츠온 REITs ON</text>
  </g>
  <text x="72" y="232" font-family="${FONT}" font-size="${nameSize}" font-weight="800" fill="#172033">${xml(nm)}</text>
  <text x="76" y="286" font-family="${FONT}" font-size="26" font-weight="700" fill="#3254ff">${xml(sector)}</text>
  ${cells}
  <text x="72" y="592" font-family="${FONT}" font-size="24" font-weight="600" fill="#8a93a8">${BASE} · 실시간 아님 · 교육용(투자 권유 아님)</text>
  <text x="1128" y="592" font-family="${FONT}" font-size="24" font-weight="700" fill="#5a647b" text-anchor="end">${xml(footRight || '')}</text>
</svg>`;
}

// 시세 동결(거래정지 등) 종목: 동결 가격 기반 수익률·P/NAV는 공유카드에서도 숨긴다.
const MAX_ASOF = seed.reits.map((r) => r.priceAsOf).filter(Boolean).sort().pop() || null;
const isStale = (r) => MAX_ASOF && r.priceAsOf && r.priceAsOf < MAX_ASOF
  && Math.round((new Date(MAX_ASOF) - new Date(r.priceAsOf)) / 86400000) >= 7;

function reitSvg(r) {
  if (isStale(r)) {
    const nmS = nextDivMonth(r.divMonths);
    return card(r.name, r.primary || '상장리츠',
      statCell(72, '실배당수익률', '산정 보류', '시세 동결 · 거래정지 가능', 'warn')
      + statCell(432, 'P/NAV', '산정 보류', '최신 시세 확인 필요', 'warn')
      + statCell(792, '다음 배당기준월', (nmS ? nmS + '월' : '—'), (r.divMonths || []).map((m) => m + '월').join('·')),
      '');
  }
  const d = dividendDisplay(r, r.price);
  const nv = navDisplay(r.navPerShare, r.price);
  const nm = nextDivMonth(r.divMonths);
  const c1 = d.show
    ? (d.isDiv ? statCell(72, '실배당수익률 (TTM)', (d.yield != null ? d.yield + '%' : '—'), d.badge !== '실적' ? d.badge : '공시 실적', d.tone === 'warn' ? 'warn' : '')
      : statCell(72, '실배당수익률', '무배당', '최근 12개월', 'warn'))
    : statCell(72, '실배당수익률', '—', '');
  const c2 = nv
    ? statCell(432, 'P/NAV (장부 순자산)', nv.pnav + '배', nv.premium ? '할증 ' + Math.abs(nv.discountPct) + '%' : '할인 ' + nv.discountPct + '%')
    : statCell(432, 'P/NAV', '산정중', '데이터 확보 시');
  const c3 = statCell(792, '다음 배당기준월', (nm ? nm + '월' : '—'), (r.divMonths || []).map((m) => m + '월').join('·'));
  const foot = r.price != null ? fmt(r.price) + '원' : '';
  return card(r.name, r.primary || '상장리츠', c1 + c2 + c3, foot);
}

function infraSvg(x) {
  const m = x.market || {};
  const c1 = statCell(72, '현재가', m.price != null ? fmt(m.price) + '원' : '—', m.changePct != null ? (m.changePct > 0 ? '+' : '') + m.changePct + '%' : '');
  const c2 = statCell(432, '유형', '인프라펀드', '리츠 아님', 'warn');
  const c3 = statCell(792, '분배', '반기', (x.divMonths || []).map((m2) => m2 + '월').join('·'));
  return card(x.shortName || x.name, x.assetText || '인프라펀드', c1 + c2 + c3, '');
}

// ---- 렌더 ----
const hashesPath = join(ROOT, 'data', 'og-hashes.json');
let hashes = {}; try { hashes = JSON.parse(readFileSync(hashesPath, 'utf8')); } catch { /* 최초 */ }
const nextHashes = {};
const opts = { font: { loadSystemFonts: true, defaultFontFamily: 'NanumGothic' }, fitTo: { mode: 'width', value: 1200 } };
let wrote = 0, skipped = 0, missing = 0;

function renderIf(ticker, svg) {
  const h = createHash('sha1').update(svg).digest('hex').slice(0, 16);
  nextHashes[ticker] = h;
  const out = join(ROOT, 'r', ticker, 'og.png');
  if (hashes[ticker] === h && existsSync(out)) { skipped++; return; }
  try { writeFileSync(out, new Resvg(svg, opts).render().asPng()); wrote++; }
  catch (e) { missing++; console.log(`  ! ${ticker} 렌더 실패: ${e.message}`); }
}

for (const r of seed.reits) renderIf(r.ticker, reitSvg(r));
for (const x of INFRA) renderIf(x.ticker, infraSvg(x));

writeFileSync(hashesPath, JSON.stringify(nextHashes) + '\n', 'utf8');
console.log(`OG 이미지: 신규/갱신 ${wrote} · 유지 ${skipped}${missing ? ' · 실패 ' + missing : ''}`);
