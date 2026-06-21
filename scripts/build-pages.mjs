// SSG: 종목별 정적 페이지 생성기.
// index.html에 박힌 seed-data(상장리츠 25개)를 읽어 /r/<ticker>/index.html 를 만들고 sitemap.xml 갱신.
// GitHub Actions cron(또는 `node scripts/build-pages.mjs`)으로 주기 재생성.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://seonghoonkim2.github.io/reits-on';
const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (t) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[t]));
const fmt = (n) => Number(n).toLocaleString('ko-KR');

// ---- seed 추출 ----
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const m = html.match(/<script id="seed-data" type="application\/json">([\s\S]*?)<\/script>/);
if (!m) { console.error('seed-data를 찾지 못했습니다.'); process.exit(1); }
const seed = JSON.parse(m[1]);
const REITS = seed.reits;

// ---- 핵심 팩트(provenance): data/reits.json이 단일 진실원천. 임베드 seed엔 facts가 없어 직접 읽음 ----
const FACTS_BY_TICKER = {};
const IR_BY_TICKER = {};
const REPORT_BY_TICKER = {};
const RISK_BY_TICKER = {};
const DETAIL_BY_TICKER = {};
try {
  const reitsDoc = JSON.parse(readFileSync(join(ROOT, 'data', 'reits.json'), 'utf8'));
  for (const x of reitsDoc.reits) {
    if (x.facts) FACTS_BY_TICKER[x.ticker] = x.facts;
    if (x.irResources) IR_BY_TICKER[x.ticker] = x.irResources;
    if (x.reportSummary) REPORT_BY_TICKER[x.ticker] = x.reportSummary;
    if (x.risk) RISK_BY_TICKER[x.ticker] = x.risk;
    if (x.reportDetail) DETAIL_BY_TICKER[x.ticker] = x.reportDetail;
  }
} catch { /* data 없으면 팩트 섹션 생략 */ }

// 리스크 배너: 회생/적자·무배당 등 중대 리스크 종목 상단 경고
function riskBanner(r) {
  const k = RISK_BY_TICKER[r.ticker];
  if (!k) return '';
  return `  <div class="risk-banner risk-${esc(k.level)}"><b>⚠ ${esc(k.label)}</b>${k.note ? ` <span>${esc(k.note)}</span>` : ''}</div>`;
}
const STATUS_LABEL = { actual:'실측', estimated:'추정', annualized:'연환산', user_input:'입력', stale:'갱신지연', unavailable:'미확보' };
const FACT_ROWS = [
  ['aum','AUM(자산총계)'], ['ltv','LTV(차입비율)'], ['wale','WALE(임대차잔존)'], ['occupancy','임대율/공실'],
  ['debtFixedRatio','고정금리 비중'], ['debtMaturity12m','12개월내 만기'], ['topTenant','주요 임차인'], ['tenantConcentration','임차인 집중도'],
];
function factVal(p) {
  if (!p || p.status === 'unavailable' || p.value == null) return null;
  if (p.display) return esc(p.display);
  if (typeof p.value === 'number') return esc(fmt(p.value) + (p.unit ? (' ' + p.unit) : ''));
  return esc(String(p.value) + (p.unit ? (' ' + p.unit) : ''));
}
function factsGrid(facts) {
  const cells = FACT_ROWS.map(([k, label]) => {
    const p = facts[k]; const val = factVal(p);
    const st = (p && p.status) || 'unavailable';
    const stPill = `<span class="st st-${st}">${esc(STATUS_LABEL[st] || st)}</span>`;
    const meta = val
      ? ((p.asOf ? esc(p.asOf) + ' · ' : '') + (p.sourceUrl ? `<a href="${esc(p.sourceUrl)}" target="_blank" rel="noopener">출처</a> · ` : '') + stPill)
      : stPill;
    return `<div class="fact"><div class="fl">${esc(label)}</div><div class="fv${val ? '' : ' na'}">${val || '자료 확인 필요'}</div><div class="fm">${meta}</div></div>`;
  }).join('');
  return `<div class="facts-grid">${cells}</div>`;
}

// 투자보고서 정리: 개요 + 보유 자산 + 보고서 핵심 수치 + 운영 지표(provenance) + 특이사항 을 한 구역으로 체계화
function reportSection(r) {
  const facts = FACTS_BY_TICKER[r.ticker];
  const s = REPORT_BY_TICKER[r.ticker];
  if (!facts && !s) return '';
  const meta = s ? ((s.reportTitle ? esc(s.reportTitle) : '투자보고서')
    + (s.asOf ? ` · ${esc(s.asOf)} 기준` : '')
    + (s.sourceUrl ? ` · <a href="${esc(s.sourceUrl)}" target="_blank" rel="noopener">출처</a>` : '')) : '출처·기준일 표시';

  const block = (title, inner) => inner ? `<div class="rs-block"><h3 class="rs-h">${title}</h3>${inner}</div>` : '';

  const pf = (s && s.portfolio && s.portfolio.length)
    ? `<div class="rs-chips">${s.portfolio.map((a) => {
        const sub = [a.type, a.location].filter(Boolean).map(esc).join(' · ');
        return `<span class="rs-chip">${esc(a.name)}${sub ? `<i>${sub}</i>` : ''}</span>`;
      }).join('')}</div>` : '';

  const hi = (s && s.highlights && s.highlights.length)
    ? `<div class="rs-grid">${s.highlights.map((h) =>
        `<div class="rs-item"${h.quote ? ` title="원문: ${esc(h.quote)}"` : ''}><div class="rs-l">${esc(h.label)}</div><div class="rs-v">${esc(h.value)}</div></div>`).join('')}</div>` : '';

  const ops = facts ? factsGrid(facts) : '';
  const note = (s && s.note) ? `<div class="rs-note">📝 ${esc(s.note)}</div>` : '';

  return `
  <div class="card">
    <div class="facts-head"><h2 style="margin:0;font-size:18px">투자보고서 정리</h2><span class="fh-as">${meta}</span></div>
    ${block(`보유 자산${s && s.portfolio && s.portfolio.length ? ` (${s.portfolio.length})` : ''}`, pf)}
    ${block('보고서 핵심 수치', hi)}
    ${block('운영 지표 <span class="rs-hint">(출처·기준일 · 미확보는 “자료 확인 필요”)</span>', ops)}
    ${note}
  </div>`;
}

const freqLabel = (n) => n >= 4 ? '분기 배당(연 4회)' : n === 2 ? '반기 배당(연 2회)' : n === 1 ? '연 1회 배당' : ('연 ' + n + '회 배당');
const naver = (t) => /^\d{6}$/.test(t) ? ('https://finance.naver.com/item/main.naver?code=' + t) : null;

// 투자보고서 상세(쇼케이스): 개요·보유자산·임대·재무·배당·차입을 가독성 높게 구성. reportDetail 보유 종목만.
function dl(rows) {
  const items = (rows || []).filter((x) => x && x.value != null && x.value !== '');
  if (!items.length) return '';
  return `<div class="rd-dl">${items.map((x) =>
    `<div class="rd-k">${esc(x.label)}</div><div class="rd-v">${esc(x.value)}</div>`).join('')}</div>`;
}
function reportDetail(r) {
  const d = DETAIL_BY_TICKER[r.ticker];
  if (!d) return '';
  const facts = FACTS_BY_TICKER[r.ticker];
  const head = [d.reportTitle, d.fiscalPeriod, d.asOf ? d.asOf + ' 기준' : null].filter(Boolean).map(esc).join(' · ')
    + (d.sourceUrl ? ` · <a href="${esc(d.sourceUrl)}" target="_blank" rel="noopener">DART 원문</a>` : '');
  const sec = (title, inner) => inner ? `<h3 class="rd-h">${title}</h3>${inner}` : '';

  // 개요
  const overview = dl(d.overview);

  // 보유 자산
  const assets = (d.assets && d.assets.length) ? `<div class="rd-assets">${d.assets.map((a) => {
    const rows = dl([
      { label: '소재지', value: a.location }, { label: '용도', value: a.use },
      { label: '연면적', value: a.grossFloorArea }, { label: '대지면적', value: a.landArea },
      { label: '규모', value: a.scale }, { label: '준공', value: a.completion },
      { label: '취득가액', value: a.acquisitionPrice }, { label: '감정평가액', value: a.appraisalValue },
      { label: '임대율', value: a.occupancy }, { label: '주요 임차인', value: a.mainTenant },
    ]);
    return `<div class="rd-asset"><div class="rd-asset-h"><span class="rd-an">${esc(a.name)}</span></div>${rows}${a.note ? `<p class="rd-anote">${esc(a.note)}</p>` : ''}</div>`;
  }).join('')}</div>` : '';

  // 자산 가치(감정평가)
  const valuation = dl(d.valuation);

  // 임대 현황
  let lease = '';
  if (d.lease) {
    const ld = dl([{ label: '임대율', value: d.lease.occupancy }, { label: 'WALE(가중평균 잔여임대차)', value: d.lease.wale }]);
    const tenants = (d.lease.tenants && d.lease.tenants.length)
      ? `<div class="rd-scroll"><table class="rd-table"><thead><tr><th>임차인</th><th class="num">비중</th><th>만기</th></tr></thead><tbody>${d.lease.tenants.map((t) =>
          `<tr><td>${esc(t.name)}</td><td class="num">${esc(t.share || '-')}</td><td>${esc(t.expiry || '-')}</td></tr>`).join('')}</tbody></table></div>` : '';
    lease = (ld || tenants || d.lease.note) ? (ld + tenants + (d.lease.note ? `<p class="rd-anote">${esc(d.lease.note)}</p>` : '')) : '';
  }

  // 재무
  const fin = (d.financials && d.financials.length)
    ? `<div class="rd-scroll"><table class="rd-table"><tbody>${d.financials.map((f) =>
        `<tr><td>${esc(f.label)}</td><td class="num">${esc(f.value)}</td></tr>`).join('')}</tbody></table></div>` : '';

  // 배당
  let div = '';
  if (d.dividends) {
    const meta = dl([{ label: '배당 정책', value: d.dividends.policy }, { label: '배당수익률', value: d.dividends.yield }]);
    const hist = (d.dividends.history && d.dividends.history.length)
      ? `<div class="rd-scroll"><table class="rd-table"><thead><tr><th>기수</th><th class="num">주당배당금</th><th>비고</th></tr></thead><tbody>${d.dividends.history.map((h) =>
          `<tr><td>${esc(h.period)}</td><td class="num">${esc(h.perShare || '-')}</td><td>${esc(h.note || '-')}</td></tr>`).join('')}</tbody></table></div>` : '';
    div = meta + hist;
  }

  // 차입 구조
  let debt = '';
  if (d.debt) {
    const meta = dl(d.debt.summary);
    const items = (d.debt.items && d.debt.items.length)
      ? `<div class="rd-scroll"><table class="rd-table"><thead><tr><th>구분</th><th>차입처</th><th class="num">금액</th><th class="num">금리</th><th>만기</th></tr></thead><tbody>${d.debt.items.map((it) =>
          `<tr><td>${esc(it.type || '-')}</td><td>${esc(it.lender || '-')}</td><td class="num">${esc(it.amount || '-')}</td><td class="num">${esc(it.rate || it.rateType || '-')}</td><td>${esc(it.maturity || '-')}</td></tr>`).join('')}</tbody></table></div>` : '';
    debt = meta + items + (d.debt.note ? `<p class="rd-anote">${esc(d.debt.note)}</p>` : '');
  }

  const risks = (d.risks && d.risks.length)
    ? `<ul class="rd-ul">${d.risks.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';

  const ops = facts ? `<div class="rd-ops">${factsGrid(facts)}</div>` : '';

  return `
  <div class="card rd">
    <div class="facts-head"><h2 style="margin:0;font-size:18px">투자보고서 상세</h2></div>
    <p class="rd-src">${head}</p>
    ${sec('📌 개요', overview)}
    ${sec(`🏢 보유 자산${d.assets && d.assets.length ? ` (${d.assets.length})` : ''}`, assets)}
    ${sec('🧾 자산 가치(감정평가)', valuation)}
    ${sec('🔑 임대 현황', lease)}
    ${sec('💰 재무 현황', fin)}
    ${sec('📈 배당', div)}
    ${sec('🏦 차입 구조', debt)}
    ${sec('⚠ 리스크 요인', risks)}
    ${sec('🔎 운영 지표 <span class="rs-hint">(출처·기준일·status)</span>', ops)}
  </div>`;
}

// IR 원문 인라인 뷰어: 렌더링된 페이지 이미지를 펼쳐보기로 노출(클릭 이탈 없이 본문 확인)
function irViewer(ir) {
  const v = ir.viewer;
  if (!v || !Array.isArray(v.images) || !v.images.length) return '';
  const lr = ir.latestReport || {};
  const capped = v.totalPages && v.shownPages && v.shownPages < v.totalPages;
  const date = lr.date ? ` · ${esc(lr.date)} 기준` : '';
  const meta = `${esc(v.kind || 'IR 자료')} · ${v.shownPages}${capped ? '/' + v.totalPages : ''}p${date}`;
  const imgs = v.images.map((src, i) =>
    `<img loading="lazy" src="../../${esc(src)}" alt="IR ${i + 1}페이지" />`).join('');
  return `
    <details class="ir-viewer" open>
      <summary>📑 IR 자료 바로보기 <span class="sub">(${meta})</span></summary>
      <div class="ir-pages">${imgs}</div>
      ${capped ? `<p class="sub" style="margin:8px 2px">※ 전체 ${v.totalPages}페이지 중 앞 ${v.shownPages}페이지 미리보기 — 전체는 아래 ‘원본 PDF’</p>` : ''}
      ${v.pdfUrl ? `<p style="margin:6px 2px"><a class="more" href="${esc(v.pdfUrl)}" target="_blank" rel="noopener">원본 PDF 새 탭에서 열기 ↗</a></p>` : ''}
    </details>`;
}

// IR 자료 한눈에: 인라인 뷰어(있으면) + 공식 IR 자료실/시세 바로가기
function irCard(r, naverUrl) {
  const ir = IR_BY_TICKER[r.ticker] || {};
  const lr = ir.latestReport;
  const irPage = ir.irPage || r.homepage;
  const viewer = irViewer(ir);
  const latest = (!viewer && lr && lr.url)
    ? `<p class="ir-latest">📄 최신 자료: <a href="${esc(lr.url)}" target="_blank" rel="noopener">${esc(lr.title || '투자보고서')}</a>${lr.date ? ` <span class="sub">(${esc(lr.date)} 기준)</span>` : ''}</p>`
    : '';
  return `
  <div class="card">
    <h2 style="margin:0 0 8px;font-size:18px">IR 자료 한눈에</h2>
    ${viewer || latest}
    <div class="links">
      ${irPage ? `<a href="${esc(irPage)}" target="_blank" rel="noopener">📑 IR 자료실</a>` : ''}
      ${r.homepage ? `<a href="${esc(r.homepage)}" target="_blank" rel="noopener">IR 홈페이지</a>` : ''}
      ${naverUrl ? `<a href="${naverUrl}" target="_blank" rel="noopener">현재가(네이버 금융)</a>` : ''}
      <a href="https://kind.krx.co.kr/" target="_blank" rel="noopener">KIND</a>
    </div>
    <p style="margin:14px 0 0"><a class="cta" href="../../">앱에서 배당 캘린더·월배당 포트폴리오 보기 →</a></p>
  </div>`;
}

function sectorQuestions(r) {
  const q = ['최근 배당의 재원이 임대수익인지, 매각차익·특별배당인지 확인'];
  q.push('차입금 만기·평균 금리, 리파이낸싱 일정 확인');
  if (r.sector.includes('해외')) q.push('환율·현지 금리·환헤지 비용이 배당에 주는 영향');
  if (r.sector.includes('리테일')) q.push('소비 경기와 핵심 임차인 매출 안정성');
  if (r.primary === '호텔' || r.sector.includes('호텔')) q.push('객실 가동률·ADR·RevPAR 추이');
  if (r.sector.includes('주거') || r.sector.includes('개발')) q.push('임대료 규제·매각/개발 계획의 영향');
  q.push('주요 임차인·WALE(임대차 잔존)와 공실률');
  return q;
}

function page(r) {
  const url = BASE + '/r/' + r.ticker + '/';
  const annual = r.recentDiv ? r.recentDiv * r.divMonths.length : null;
  const title = `${r.name} (${r.ticker}) 배당·정보 | 리츠온 REITs ON`;
  const desc = `${r.name}: ${r.primary} 상장리츠. 배당기준월 ${r.divMonths.map(x=>x+'월').join('·')}, ${freqLabel(r.divMonths.length)}` + (annual ? `, 연환산 추정 배당 약 ${fmt(annual)}원/주.` : '.') + ' 배당월·자산·확인 포인트를 한눈에. (교육용 정보, 투자 권유 아님)';
  const monthCells = MONTHS.map((lab,i)=>`<span class="mc${r.divMonths.includes(i+1)?' on':''}">${i+1}</span>`).join('');
  const naverUrl = naver(r.ticker);
  const ld = {
    '@context':'https://schema.org','@type':'WebPage', name:title, url, inLanguage:'ko',
    description: desc,
    isPartOf:{ '@type':'WebSite', name:'리츠온 REITs ON', url: BASE + '/' },
    about:{ '@type':'Corporation', name:r.name, tickerSymbol:r.ticker }
  };
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<link rel="canonical" href="${url}" />
<link rel="icon" href="../../favicon.svg" type="image/svg+xml" />
<meta name="theme-color" content="#3254ff" />
<meta property="og:type" content="article" />
<meta property="og:title" content="${esc(r.name + ' · 배당·정보')}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:url" content="${url}" />
<meta property="og:image" content="${BASE}/og.png" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="${BASE}/og.png" />
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<style>
:root{--brand:#3254ff;--bg:#f5f7fb;--surface:#fff;--text:#172033;--muted:#515b72;--line:#e5e9f2;--soft:#eef1f7;--tint:#edf1ff;--ok:#0c9b69;--okt:#e4f5ec}
*{box-sizing:border-box}body{margin:0;font-family:'Pretendard','Apple SD Gothic Neo','Malgun Gothic',system-ui,sans-serif;background:var(--bg);color:var(--text);line-height:1.6}
.wrap{max-width:760px;margin:0 auto;padding:20px 18px 60px}
.top{display:flex;align-items:center;gap:10px;padding:14px 0}
.logo{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#3254ff,#00a78e);color:#fff;font-weight:900;display:grid;place-items:center;text-decoration:none}
.top a.brand{color:var(--text);text-decoration:none;font-weight:800}
.eyebrow{display:inline-block;font-size:12px;font-weight:800;color:var(--brand);background:var(--tint);border-radius:999px;padding:5px 12px}
.risk-banner{margin:12px 0 0;padding:10px 14px;border-radius:12px;font-size:13.5px;line-height:1.5}
.risk-banner b{font-weight:900}.risk-banner span{color:inherit;opacity:.9}
.risk-banner.risk-high{background:#fdecea;border:1px solid #f3c0ba;color:#b42318}
.risk-banner.risk-caution{background:#fdf6e3;border:1px solid #f2e0a8;color:#9a6700}
h1{font-size:28px;letter-spacing:-1px;margin:14px 0 4px}
.tk{color:var(--muted);font-weight:700}
.card{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin-top:14px}
.hero{font-size:30px;font-weight:950;letter-spacing:-1px}
.sub{color:var(--muted);font-size:14px}
.months{display:grid;grid-template-columns:repeat(12,1fr);gap:5px;margin-top:8px}
.mc{font-size:11px;text-align:center;line-height:30px;border-radius:8px;background:var(--soft);color:var(--muted);font-weight:700}
.mc.on{background:var(--brand);color:#fff}
.rows{display:grid;gap:0}.row{display:flex;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid var(--soft);font-size:15px}.row:last-child{border-bottom:0}.row span{color:var(--muted)}.row b{font-weight:800;text-align:right}
ul.q{margin:8px 0 0;padding-left:18px}ul.q li{margin:6px 0}
.ir-latest{margin:0 0 10px;font-size:14px;background:var(--tint);border-radius:10px;padding:10px 12px}
.ir-latest a{color:var(--brand);font-weight:800;text-decoration:none}
.rd-src{font-size:12.5px;color:var(--muted);margin:0 0 6px}
.rd .rd-h{font-size:15px;font-weight:850;margin:20px 0 10px;padding-bottom:7px;border-bottom:2px solid var(--tint)}
.rd-dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;font-size:14px;align-items:baseline}
.rd-k{color:var(--muted);font-weight:700;white-space:nowrap}
.rd-v{font-weight:650}
.rd-assets{display:grid;gap:10px}
.rd-asset{border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:var(--surface)}
.rd-asset-h{display:flex;justify-content:space-between;gap:8px;align-items:baseline;margin-bottom:8px}
.rd-an{font-weight:850;font-size:15px;letter-spacing:-.02em}
.rd-tag{flex:0 0 auto;font-size:11px;font-weight:800;color:var(--brand);background:var(--tint);border-radius:999px;padding:2px 9px}
.rd-anote{margin:8px 0 0;font-size:12.5px;color:var(--muted);line-height:1.5}
.rd-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:2px 0}
.rd-table{width:100%;border-collapse:collapse;font-size:13.5px;min-width:280px}
.rd-table th,.rd-table td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--soft);white-space:nowrap}
.rd-table th{color:var(--muted);font-weight:800;background:var(--soft)}
.rd-table td.num,.rd-table th.num{text-align:right;font-variant-numeric:tabular-nums}
.rd-ul{margin:0;padding-left:18px;font-size:13.5px;color:var(--muted)}
.rd-ul li{margin:5px 0;line-height:1.5}
.rd-ops{margin-top:4px}
.rs-block{margin:0 0 16px}
.rs-block:last-child{margin-bottom:0}
.rs-h{font-size:13px;font-weight:800;color:var(--text);margin:0 0 8px;padding-bottom:6px;border-bottom:1px solid var(--soft)}
.rs-hint{font-weight:600;font-size:11px;color:var(--muted)}
.rs-note{font-size:13px;color:var(--muted);background:var(--soft);border-radius:10px;padding:10px 12px;line-height:1.55}
.rs-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:0}
@media (max-width:380px){.rs-grid{grid-template-columns:1fr}}
.rs-item{border:1px solid var(--line);border-radius:10px;padding:8px 10px;background:var(--surface)}
.rs-l{font-size:12px;color:var(--muted);font-weight:700}
.rs-v{font-size:16px;font-weight:800;margin-top:2px}
.rs-pfh{font-size:13px;color:var(--muted);font-weight:800;margin:2px 0 6px}
.rs-chips{display:flex;flex-wrap:wrap;gap:6px}
.rs-chip{display:inline-flex;flex-direction:column;border:1px solid var(--line);background:var(--soft);border-radius:9px;padding:6px 10px;font-size:13px;font-weight:700}
.rs-chip i{font-style:normal;font-weight:600;color:var(--muted);font-size:11px;margin-top:1px}
.ir-viewer{margin:0 0 12px;border:1px solid var(--line);border-radius:12px;background:var(--soft);padding:10px 12px}
.ir-viewer>summary{cursor:pointer;font-weight:800;font-size:15px;list-style:none}
.ir-viewer>summary::-webkit-details-marker{display:none}
.ir-viewer>summary:hover{color:var(--brand)}
.ir-pages{display:flex;flex-direction:column;gap:8px;margin-top:10px}
.ir-pages img{width:100%;height:auto;border:1px solid var(--line);border-radius:8px;background:#fff;display:block}
.links{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.links a{display:inline-block;border:1px solid var(--line);background:var(--surface);border-radius:999px;padding:9px 14px;text-decoration:none;color:var(--text);font-weight:700;font-size:14px}
.cta{display:inline-block;background:var(--brand);color:#fff;border-radius:999px;padding:12px 18px;text-decoration:none;font-weight:800;margin-top:6px}
.note{font-size:12.5px;color:var(--muted);margin-top:18px;line-height:1.6}
.badge{font-size:12px;font-weight:800;border-radius:999px;padding:4px 10px;background:var(--okt);color:var(--ok)}
a.more{color:var(--brand);font-weight:800;text-decoration:none}
.facts-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin:0 0 10px}
.facts-head .fh-as{font-size:11px;color:var(--muted)}
.facts-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
@media (max-width:380px){.facts-grid{grid-template-columns:1fr}}
.fact{border:1px solid var(--line);border-radius:13px;padding:10px 11px;background:var(--soft)}
.fact .fl{font-size:11.5px;color:var(--muted);font-weight:700}
.fact .fv{font-size:16px;font-weight:900;letter-spacing:-.02em;margin-top:3px;color:var(--text)}
.fact .fv.na{font-size:13px;font-weight:700;color:var(--muted)}
.fact .fm{font-size:10.5px;color:var(--muted);margin-top:4px;line-height:1.4}
.fact .fm a{color:var(--brand);text-decoration:underline;text-underline-offset:2px}
.st{display:inline-block;font-size:10px;font-weight:800;border-radius:6px;padding:1px 6px}
.st-actual{background:var(--okt);color:var(--ok)}
.st-estimated,.st-annualized{background:var(--tint);color:var(--brand)}
.st-stale{background:#fff3d6;color:#9a6b00}
.st-unavailable,.st-user_input{background:var(--soft);color:var(--muted)}
</style>
</head>
<body>
<div class="wrap">
  <div class="top"><a class="logo" href="../../">R</a><a class="brand" href="../../">리츠온 REITs ON</a></div>
  <span class="eyebrow">상장리츠 · ${esc(r.primary)}</span>
  <h1>${esc(r.name)}</h1>
  <div class="tk">종목코드 ${esc(r.ticker)} · ${esc(r.sector.join(', '))}</div>
${riskBanner(r)}

  <div class="card">
    <div class="hero">${annual ? fmt(annual) + '원 <span class="sub">/주 (연환산 추정)</span>' : '<span class="sub">최근배당금 공시 확인 필요</span>'}</div>
    ${annual ? `<div class="sub">월 환산 약 ${fmt(Math.round(annual/12))}원/주 · 최근배당금 ${fmt(r.recentDiv)}원(1회)×${r.divMonths.length}회 단순 추정</div>` : ''}
    <div class="months" role="img" aria-label="배당기준월 ${r.divMonths.map(x=>x+'월').join(', ')}">${monthCells}</div>
    <div class="sub" style="margin-top:8px">${esc(freqLabel(r.divMonths.length))} · 배당기준월 ${r.divMonths.map(x=>x+'월').join('·')}</div>
  </div>

  <div class="card">
    <div class="rows">
      <div class="row"><span>대표 자산군</span><b>${esc(r.primary)}</b></div>
      <div class="row"><span>세부 섹터</span><b>${esc(r.sector.join(', '))}</b></div>
      <div class="row"><span>자산총계</span><b>${esc(r.assetText)}</b></div>
      <div class="row"><span>결산/배당 빈도</span><b>${esc(freqLabel(r.divMonths.length))}</b></div>
      <div class="row"><span>특징</span><b>${esc(r.tags.join(', '))}</b></div>
    </div>
  </div>
${reportDetail(r) || reportSection(r)}
  <div class="card">
    <h2 style="margin:0 0 6px;font-size:18px">한 줄 메모</h2>
    <p style="margin:0;color:var(--muted)">${esc(r.note)}</p>
  </div>

  <div class="card">
    <h2 style="margin:0 0 6px;font-size:18px">투자 전 확인 포인트</h2>
    <ul class="q">${sectorQuestions(r).map(q=>`<li>${esc(q)}</li>`).join('')}</ul>
  </div>

${irCard(r, naverUrl)}

  <p class="note">⚠ 본 페이지는 일반 투자자 교육·정보 제공용이며 <b>특정 종목의 매수·매도 추천이 아닙니다.</b> 배당금·연환산 수치는 공개자료(한국리츠협회 등) 기반의 <b>교육용 추정</b>으로 실제와 다를 수 있고, 리츠는 배당 삭감·중단 및 원금 손실이 가능합니다. 투자 전 DART·KIND·투자보고서 원문과 최신 시세를 반드시 확인하세요. 데이터 기준일은 변동될 수 있습니다.</p>
  <p class="note"><a class="more" href="../../">← 리츠온 홈으로</a></p>
</div>
</body>
</html>`;
}

// ---- 생성 ----
const rDir = join(ROOT, 'r');
// 기존 r/ 정리(없어진 종목 제거)
if (existsSync(rDir)) { for (const d of readdirSync(rDir)) rmSync(join(rDir, d), { recursive: true, force: true }); }
let count = 0;
for (const r of REITS) {
  const dir = join(rDir, r.ticker);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), page(r), 'utf8');
  count++;
}

// ---- sitemap ----
const today = new Date().toISOString().slice(0, 10);
const urls = [BASE + '/'].concat(REITS.map(r => BASE + '/r/' + r.ticker + '/'));
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls.map(u => `  <url>\n    <loc>${u}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>${u.endsWith('/reits-on/') ? '1.0' : '0.7'}</priority>\n  </url>`).join('\n') +
  `\n</urlset>\n`;
writeFileSync(join(ROOT, 'sitemap.xml'), sitemap, 'utf8');

console.log(`생성 완료: 종목 페이지 ${count}개 + sitemap(${urls.length} URL)`);
