// data/filings.json(유의미 공시) + data/reits.json(종목명) → filings.xml(RSS 2.0).
// 재방문 장치: 투자자가 RSS 리더로 보유 리츠의 주요 공시를 구독할 수 있게 한다.
// 원문 요약이 아니라 '공시 유형 해설'만 붙인다(날조 방지 — 사이트 원칙과 동일).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://seonghoonkim2.github.io/reits-on';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (t) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[t]));

const reits = JSON.parse(readFileSync(join(ROOT, 'data', 'reits.json'), 'utf8')).reits;
const nameOf = {}; reits.forEach((r) => { nameOf[r.ticker] = r.name; });

let filingsDoc = { filings: [] };
try { filingsDoc = JSON.parse(readFileSync(join(ROOT, 'data', 'filings.json'), 'utf8')); } catch { /* 없으면 빈 피드 */ }
const filings = Array.isArray(filingsDoc.filings) ? filingsDoc.filings : [];

// 공시 유형 해설(간결판) — index.html의 FILING_RULES와 동일 취지.
const RULES = [
  [/(관리종목|상장폐지|거래정지|자본잠식)/, '⚠ 상장 유지·재무에 영향을 주는 중대 공시. 사유와 후속 공시를 확인하세요.'],
  [/(회생|파산|부도)/, '⚠ 재무 위기 관련 중대 공시. 원문을 반드시 확인하세요.'],
  [/유상증자/, '새 주식 발행 공시. 주식 수 증가로 주당 배당이 희석될 수 있어요.'],
  [/(배당|분배금)/, '배당(분배금) 공시. 1주당 금액·기준일·지급일과 재원을 확인하세요.'],
  [/(매각|처분|양도)/, '자산 매각 공시. 매각차익은 일회성 특별배당일 수 있어요.'],
  [/(양수|취득|편입|매입|임대)/, '자산 취득·임대 공시. 자금 조달 방식과 임차 조건을 확인하세요.'],
  [/(차입|대출|사채|차환|리파이낸싱)/, '차입·사채 공시. 금리·만기가 이자비용과 배당에 영향을 줍니다.'],
  [/(임대차|임차|책임임대|마스터리스)/, '임차인·임대차 공시. 임차인 신용도·임대료·기간을 확인하세요.'],
  [/(감사보고서|검토보고서|사업보고서|분기보고서|반기보고서)/, '정기·감사 보고서. 감사의견과 실적 추세를 확인하세요.'],
  [/(주주총회|주총)/, '주주총회 관련 공시. 배당·임원·정관 등 안건을 확인하세요.'],
  [/(신용등급|신용평가)/, '신용등급 공시. 차입 비용·배당 여력과 연결됩니다.'],
];
const explain = (title) => { for (const [re, msg] of RULES) if (re.test(title || '')) return msg; return '주요 공시. 제목을 눌러 DART 원문에서 핵심을 확인하세요.'; };

// "2026-07-02" → RFC822(+0900). 파싱 실패 시 현재.
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function rfc822(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ''));
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : new Date();
  return `${DOW[d.getUTCDay()]}, ${String(d.getUTCDate()).padStart(2, '0')} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()} 09:00:00 +0900`;
}

const items = filings.slice(0, 60).map((f) => {
  const nm = nameOf[f.ticker] || f.ticker || '';
  const title = `[${nm}] ${f.title}`.trim();
  return `    <item>
      <title>${esc(title)}</title>
      <link>${esc(f.url || BASE)}</link>
      <guid isPermaLink="false">${esc(f.rcept_no || (f.ticker + f.filed_at))}</guid>
      <pubDate>${rfc822(f.filed_at)}</pubDate>
      <description>${esc(explain(f.title))}</description>
    </item>`;
}).join('\n');

const lastBuild = rfc822(filingsDoc.retrievedAt ? String(filingsDoc.retrievedAt).slice(0, 10) : null);
const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>리츠온 · 국내 상장리츠 주요 공시</title>
    <link>${BASE}/</link>
    <atom:link xmlns:atom="http://www.w3.org/2005/Atom" href="${BASE}/filings.xml" rel="self" type="application/rss+xml" />
    <description>국내 상장리츠 DART 주요 공시(소음 제외). 교육용 정보이며 투자 권유가 아닙니다.</description>
    <language>ko</language>
    <lastBuildDate>${lastBuild}</lastBuildDate>
${items}
  </channel>
</rss>
`;

writeFileSync(join(ROOT, 'filings.xml'), rss, 'utf8');
console.log(`filings.xml 생성: 공시 ${Math.min(filings.length, 60)}건`);
