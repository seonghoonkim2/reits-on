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
const META_BY_TICKER = {}; // {name, primary, sector}
try {
  const reitsDoc = JSON.parse(readFileSync(join(ROOT, 'data', 'reits.json'), 'utf8'));
  for (const x of reitsDoc.reits) {
    if (x.facts) FACTS_BY_TICKER[x.ticker] = x.facts;
    if (x.irResources) IR_BY_TICKER[x.ticker] = x.irResources;
    if (x.reportSummary) REPORT_BY_TICKER[x.ticker] = x.reportSummary;
    if (x.risk) RISK_BY_TICKER[x.ticker] = x.risk;
    if (x.reportDetail) DETAIL_BY_TICKER[x.ticker] = x.reportDetail;
    META_BY_TICKER[x.ticker] = { name: x.name, primary: x.primary, sector: x.sector };
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

// === '한눈에 보기' 강화 뷰(대표 3종 쇼케이스): reportDetail 데이터를 파싱해 시각화 ===
const PRO_TICKERS = new Set(['395400', '330590', '348950']);
const _num = (s) => { const m = String(s ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : null; };
const _pct = (s) => { const m = String(s ?? '').replace(/,/g, '').match(/(-?\d+(?:\.\d+)?)\s*%/); return m ? parseFloat(m[1]) : null; };
const _eok = (s) => { s = String(s ?? '').replace(/,/g, ''); let t = 0, ok = false; const jo = s.match(/(\d+(?:\.\d+)?)\s*조/); if (jo) { t += parseFloat(jo[1]) * 10000; ok = true; } const e = s.match(/(\d+(?:\.\d+)?)\s*억/); if (e) { t += parseFloat(e[1]); ok = true; } return ok ? t : null; };
const _year = (s) => { const m = String(s ?? '').match(/20\d{2}/); return m ? +m[0] : null; };
const _findVal = (arr, kw) => { if (!Array.isArray(arr)) return null; const re = new RegExp(kw); const it = arr.find((x) => x && re.test(x.label || '')); return it ? it.value : null; };
const fmtEok = (v) => v >= 10000 ? (v / 10000).toFixed(v % 10000 ? 1 : 0) + '조원' : Math.round(v).toLocaleString('ko-KR') + '억원';

// 자산군 분류(보유자산 use → 대표 유형 + 색)
const ASSET_COLORS = { 오피스: '#3254ff', 물류: '#0c9b69', 리테일: '#e0892b', 호텔: '#a855f7', 주거: '#ec4899', 주유소: '#14b8a6', 데이터센터: '#6366f1', 인프라: '#0ea5e9', 개발: '#f43f5e', 기타: '#94a3b8' };
function assetTypeOf(use) {
  const u = String(use || '');
  if (/주유소/.test(u)) return '주유소';
  if (/데이터|IDC|\bDC\b/.test(u)) return '데이터센터';
  if (/산업|인프라|수처리|발전/.test(u)) return '인프라';
  if (/물류|창고/.test(u)) return '물류';
  if (/리테일|백화점|아울렛|마트|쇼핑|판매/.test(u)) return '리테일';
  if (/호텔/.test(u)) return '호텔';
  if (/주거|임대주택|코리빙|학생|멀티패밀리|레지던스|숙박/.test(u)) return '주거';
  if (/개발/.test(u)) return '개발';
  if (/오피스|업무/.test(u)) return '오피스';
  return '기타';
}
// 종목별 비교용 수치(있을 때만)
const _inRange = (p) => (p != null && p > 0 && p <= 100) ? p : null;
function numLTV(t) {
  const f = FACTS_BY_TICKER[t] || {}; const d = DETAIL_BY_TICKER[t];
  if (f.ltv && f.ltv.status === 'actual' && typeof f.ltv.value === 'number') return _inRange(f.ltv.value);
  const s = d && _findVal(d.debt && d.debt.summary, 'LTV|레버리지');
  if (!s || /미기재|미명시|없음|해당없음|참고|부채비율/.test(String(s))) return null;
  return _inRange(_pct(s));
}
function numOcc(t) {
  const f = FACTS_BY_TICKER[t] || {}; const d = DETAIL_BY_TICKER[t];
  if (f.occupancy && f.occupancy.status === 'actual' && typeof f.occupancy.value === 'number') return _inRange(f.occupancy.value);
  return _inRange(_pct(d && d.lease && d.lease.occupancy));
}
// 같은 자산군(primary) 그룹
const PRIMARY_GROUPS = {};
for (const [t, m] of Object.entries(META_BY_TICKER)) { const p = (m && m.primary) || '기타'; (PRIMARY_GROUPS[p] = PRIMARY_GROUPS[p] || []).push(t); }

// 규칙 기반 건강 신호(투자권유 아님 — 공시수치 기반 단순 표기)
function healthOf(t) {
  const risk = RISK_BY_TICKER[t]; const f = FACTS_BY_TICKER[t] || {}; const d = DETAIL_BY_TICKER[t] || {};
  const reasons = []; let level = 'ok';
  if (risk) { level = risk.level === 'high' ? 'risk' : 'warn'; reasons.push(risk.label); }
  const ltv = numLTV(t);
  if (ltv != null) { if (ltv >= 65) { reasons.push(`LTV ${ltv}%`); level = level === 'risk' ? 'risk' : 'warn'; } else if (ltv >= 55) { reasons.push(`LTV ${ltv}%`); if (level === 'ok') level = 'warn'; } }
  const fixed = _pct(_findVal(d.debt && d.debt.summary, '고정금리') || (f.debtFixedRatio && f.debtFixedRatio.display));
  if (fixed != null && fixed <= 20) { reasons.push('변동금리 비중↑'); if (level === 'ok') level = 'warn'; }
  const fin = ((d.financials || []).map((x) => String(x.label) + ' ' + String(x.value)).join(' '));
  if (/적자|순손실/.test(fin)) { reasons.push('손실 시현'); if (level !== 'risk') level = 'warn'; }
  const recentPaid = (((d.dividends && d.dividends.history) || []).find((h) => _num(h.perShare) != null)) || {};
  const mp = String(recentPaid.note || '').match(/배당성향[^0-9]*(\d{2,3})/); if (mp && +mp[1] >= 200) { reasons.push(`배당성향 ${mp[1]}%`); if (level === 'ok') level = 'warn'; }
  if (level === 'ok' && ltv != null && ltv < 55) reasons.push('레버리지 안정');
  if (level === 'ok' && !reasons.length) reasons.push('특이 리스크 미탐지');
  return { level, reasons: reasons.slice(0, 3) };
}
function healthChip(t) {
  const h = healthOf(t);
  const map = { ok: ['🟢', '안정', 'h-ok'], warn: ['🟡', '주의', 'h-warn'], risk: ['🔴', '위험', 'h-risk'] };
  const [dot, label, cls] = map[h.level];
  return `<div class="pro-health ${cls}"><span class="hh">${dot} 건강 신호: <b>${label}</b></span>${h.reasons.length ? `<span class="hr">${esc(h.reasons.join(' · '))}</span>` : ''}<span class="hn">규칙기반 요약 · 투자권유 아님</span></div>`;
}
// 보유자산 note에서 특정 기준(감정/매입 등) 가액(억)을 추출 — 키워드 직후 조·억 표기 파싱
function valNear(note, re) {
  const m = String(note || '').match(new RegExp('(?:' + re + ')\\s*([^)]*)'));
  return m ? _eok(m[1]) : null;
}
// 자산군 구성: 동일 기준 가액이 전 자산에서 잡히면 '가액 비중', 아니면 '개수' 기준(기준 명시)
function assetMixBar(d) {
  const assets = (d && d.assets) || [];
  if (assets.length < 2) return '';
  let weights = null, basisLabel = '개수';
  for (const [re, label] of [['감정', '감정가'], ['당기말', '평가액'], ['매입가|매입|취득|투자', '매입가']]) {
    const vals = assets.map((a) => valNear(a.note, re));
    if (vals.every((v) => v != null && v > 0)) { weights = vals; basisLabel = label; break; }
  }
  const w = weights || assets.map(() => 1);
  const agg = {};
  assets.forEach((a, i) => { const ty = assetTypeOf((a.use || '') + ' ' + (a.name || '')); agg[ty] = (agg[ty] || 0) + w[i]; });
  const entries = Object.entries(agg).sort((a, b) => b[1] - a[1]);
  if (entries.length < 2) return '';
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
  const lab = (v) => weights ? esc(fmtEok(v)) : v + '개';
  const seg = entries.map(([ty, v]) => `<i style="width:${(v / total * 100).toFixed(1)}%;background:${ASSET_COLORS[ty] || '#94a3b8'}" title="${esc(ty)} ${lab(v)} (${(v / total * 100).toFixed(0)}%)"></i>`).join('');
  const leg = entries.map(([ty, v]) => `<span class="lg"><i style="background:${ASSET_COLORS[ty] || '#94a3b8'}"></i>${esc(ty)} ${(v / total * 100).toFixed(0)}%</span>`).join('');
  const aria = entries.map(([ty, v]) => `${ty} ${(v / total * 100).toFixed(0)}%`).join(', ');
  return `<div class="pro-block"><div class="pro-h">자산군 구성 (${assets.length}개 · ${basisLabel} 기준)</div><div class="pro-stack" role="img" aria-label="자산군 구성 — ${esc(aria)}">${seg}</div><div class="pro-legend">${leg}</div></div>`;
}
// 임차인 집중도(상위 임차인 비중 스택)
function tenantBar(d, facts) {
  const palette = ['#3254ff', '#0c9b69', '#e0892b', '#a855f7', '#14b8a6'];
  const tn = ((d && d.lease && d.lease.tenants) || []).map((x) => ({ name: x.name, p: _pct(x.share) })).filter((x) => x.p != null && x.p > 0);
  const sum = tn.reduce((a, x) => a + x.p, 0);
  let segs = [];
  // 1) lease.tenants 비중 합이 타당(≤105%)하고 2개 이상일 때만 다중 세그먼트
  if (tn.length >= 2 && sum > 0 && sum <= 105) {
    let acc = 0;
    tn.slice(0, 5).forEach((x, i) => { acc += x.p; segs.push({ name: x.name, p: x.p, c: palette[i % palette.length] }); });
    if (acc < 97) segs.push({ name: '기타', p: 100 - acc, c: '#cbd5e1' });
  } else if (facts && facts.tenantConcentration && facts.tenantConcentration.status === 'actual' && typeof facts.tenantConcentration.value === 'number' && facts.tenantConcentration.value <= 100) {
    // 2) 정의된 임차인 집중도(최대 임차인 비중)
    const v = facts.tenantConcentration.value;
    const top = (facts.topTenant && facts.topTenant.value) ? String(facts.topTenant.value).split(/[,(·]/)[0].trim().slice(0, 18) : '최대 임차인';
    segs = [{ name: top, p: v, c: '#3254ff' }, { name: '기타', p: Math.max(0, 100 - v), c: '#cbd5e1' }];
  }
  if (!segs.length) return '';
  const bar = segs.map((s) => `<i style="width:${s.p.toFixed(1)}%;background:${s.c}" title="${esc(s.name)} ${s.p.toFixed(1)}%"></i>`).join('');
  const leg = segs.filter((s) => s.name !== '기타').map((s) => `<span class="lg"><i style="background:${s.c}"></i>${esc(s.name)} ${s.p.toFixed(1)}%</span>`).join('');
  const aria = segs.map((s) => `${s.name} ${s.p.toFixed(0)}%`).join(', ');
  return `<div class="pro-block"><div class="pro-h">임차인 집중도</div><div class="pro-stack" role="img" aria-label="임차인 집중도 — ${esc(aria)}">${bar}</div><div class="pro-legend">${leg}</div></div>`;
}
// 동일 자산군 피어 비교(LTV·임대율, 비교 가능 수치만)
function peerCompare(r) {
  const meta = META_BY_TICKER[r.ticker]; if (!meta) return '';
  const group = (PRIMARY_GROUPS[meta.primary] || []).filter((t) => numLTV(t) != null || numOcc(t) != null);
  if (group.length < 3) return '';
  const rows = group.map((t) => ({ t, name: (META_BY_TICKER[t] || {}).name, ltv: numLTV(t), occ: numOcc(t) }))
    .sort((a, b) => (b.ltv ?? -1) - (a.ltv ?? -1));
  const maxLtv = Math.max(...rows.map((x) => x.ltv || 0), 1);
  const ltvs = rows.map((x) => x.ltv).filter((v) => v != null);
  const occs = rows.map((x) => x.occ).filter((v) => v != null);
  const avg = (a) => a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length * 10) / 10 : null;
  const avgL = avg(ltvs), avgO = avg(occs);
  const ranked = rows.filter((x) => x.ltv != null);
  const myIdx = ranked.findIndex((x) => x.t === r.ticker);
  const body = rows.map((x) => {
    const me = x.t === r.ticker;
    const nameCell = me ? `<span class="pcn">${esc(x.name)} <em>(이 종목)</em></span>` : `<a class="pcn" href="../${esc(x.t)}/">${esc(x.name)}</a>`;
    const ltvBar = x.ltv != null
      ? `<div class="pcbar" title="LTV ${x.ltv}%"><i style="width:${Math.max(3, x.ltv / maxLtv * 100)}%"></i></div><span class="pcv">${x.ltv}%</span>`
      : `<div class="pcbar"></div><span class="pcv na">–</span>`;
    return `<div class="pcrow${me ? ' me' : ''}">${nameCell}${ltvBar}<span class="pco"${x.occ != null ? ` title="임대율 ${x.occ}%"` : ''}>${x.occ != null ? x.occ + '%' : '–'}</span></div>`;
  }).join('');
  const rankTxt = myIdx >= 0 ? ` · 이 종목 LTV ${myIdx + 1}위/${ranked.length}` : '';
  const avgRow = `<div class="pcrow avg"><span class="pcn">그룹 평균</span><div class="pcbar avgbar" title="평균 LTV ${avgL ?? '–'}%">${avgL != null ? `<i style="width:${Math.max(3, avgL / maxLtv * 100)}%"></i>` : ''}</div><span class="pcv">${avgL != null ? avgL + '%' : '–'}</span><span class="pco">${avgO != null ? avgO + '%' : '–'}</span></div>`;
  return `<div class="pro-block pc-wide"><div class="pro-h">동일 자산군 비교 · ${esc(meta.primary)} (${rows.length}종)${rankTxt}</div>
    <div class="pchead"><span class="pcn">종목</span><span></span><span class="pcl">LTV ↓</span><span class="pco">임대율</span></div>
    ${body}
    ${avgRow}
    <p class="pro-cap">LTV 내림차순 정렬 · 막대에 마우스를 올리면 정확한 값. 정의·기준일 상이 가능, 임대율은 일부 단일자산 기준.</p></div>`;
}

function proDashboard(r) {
  const d = DETAIL_BY_TICKER[r.ticker];
  if (!d) return '';
  const facts = FACTS_BY_TICKER[r.ticker] || {};
  const risk = RISK_BY_TICKER[r.ticker];
  const ds = (d.debt && d.debt.summary) || [];
  const pick = (...cands) => cands.find((x) => x != null && x !== '');

  const ltvStr = pick(_findVal(ds, 'LTV|레버리지'), facts.ltv && facts.ltv.display);
  const occStr = pick([d.lease && d.lease.occupancy, facts.occupancy && facts.occupancy.display].find((x) => _pct(x) != null), facts.occupancy && facts.occupancy.display);
  const waleStr = pick([d.lease && d.lease.wale, facts.wale && facts.wale.display].find((x) => _num(x) != null));
  const rating = pick(_findVal(ds, '신용등급'), _findVal(d.overview, '신용등급'));
  const fixedStr = pick(_findVal(ds, '고정금리'), facts.debtFixedRatio && facts.debtFixedRatio.display);
  const yieldStr = d.dividends && d.dividends.yield;
  const lastDiv = d.dividends && d.dividends.history && (d.dividends.history.find((h) => _num(h.perShare) != null) || {}).perShare;

  const yPct = _pct(yieldStr), oPct = numOcc(r.ticker), lPct = numLTV(r.ticker);
  const waleVal = (facts.wale && facts.wale.display) || (() => { const m = String(waleStr || '').match(/(\d+(?:\.\d+)?)\s*년/); return m ? m[1] + '년' : null; })();
  const rGrade = (() => { const m = String(rating || '').match(/(AAA|AA[+-]?|A[+-]?|BBB[+-]?|BB[+-]?|B[+-]?|CCC[+-]?|CC|D)/); return m ? m[0] : rating; })();
  const ltvTone = lPct == null ? '' : (lPct >= 65 ? 'bad' : lPct >= 55 ? 'warn' : 'good');
  const occTone = oPct == null ? '' : (oPct >= 95 ? 'good' : oPct >= 85 ? 'warn' : 'bad');
  const rTone = /(^|[^A-Z])(D|CCC|CC)([^A-Z]|$)/.test(rGrade || '') ? 'bad' : /BBB|BB|^B/.test(rGrade || '') ? 'warn' : /A/.test(rGrade || '') ? 'good' : '';
  const kpis = [
    yPct != null && { k: '배당수익률', v: yPct + '%' + (/분기/.test(yieldStr) ? ' (분기)' : '') },
    lastDiv && { k: '최근 주당배당', v: lastDiv },
    lPct != null && { k: 'LTV', v: lPct + '%', t: ltvTone },
    oPct != null && { k: '임대율', v: oPct + '%', t: occTone },
    waleVal && { k: 'WALE', v: waleVal },
    rating && { k: '신용등급', v: rGrade, t: rTone },
  ].filter(Boolean).slice(0, 6);
  const kpiHtml = kpis.length ? `<div class="pro-kpis">${kpis.map((x) => `<div class="pro-kpi"><div class="pk-k">${esc(x.k)}</div><div class="pk-v${x.t ? ' tn-' + x.t : ''}">${esc(x.v)}</div></div>`).join('')}</div>` : '';
  const srcCap = [d.reportTitle, d.asOf ? d.asOf + ' 기준' : null].filter(Boolean).map(esc).join(' · ') + (d.sourceUrl ? ` · <a href="${esc(d.sourceUrl)}" target="_blank" rel="noopener">출처</a>` : '');

  const gauges = [
    { k: '임대율', val: oPct, cls: 'g-ok' },
    { k: 'LTV', val: lPct, cls: 'g-warn' },
    { k: '고정금리 비중', val: _pct(fixedStr), cls: 'g-ok' },
  ].filter((g) => g.val != null);
  const gaugeHtml = gauges.length ? `<div class="pro-gauges">${gauges.map((g) => `<div class="pg" role="img" aria-label="${esc(g.k)} ${g.val}%"><div class="pg-top"><span>${esc(g.k)}</span><b>${g.val}%</b></div><div class="pg-bar"><i class="${g.cls}" style="width:${Math.max(2, Math.min(100, g.val))}%"></i></div></div>`).join('')}</div>` : '';

  const hist = ((d.dividends && d.dividends.history) || []).map((h) => ({ p: h.period, v: _num(h.perShare) })).filter((x) => x.v != null).reverse();
  const maxDiv = Math.max(...hist.map((x) => x.v), 1);
  const divHtml = hist.length >= 2 ? `<div class="pro-block"><div class="pro-h">배당 추이 (주당, 원)</div><div class="pro-bars">${hist.map((x) => `<div class="bar"><span class="bv">${x.v.toLocaleString('ko-KR')}</span><i style="height:${Math.max(8, x.v / maxDiv * 100)}%"></i><span class="bl">${esc(x.p.replace(/\s*\(.*?\)/g, '').trim().slice(0, 7))}</span></div>`).join('')}</div></div>` : '';

  const items = (d.debt && d.debt.items) || [];
  const byYear = {};
  items.forEach((it) => { const y = _year(it.maturity); const a = _eok(it.amount); if (y && a) byYear[y] = (byYear[y] || 0) + a; });
  const years = Object.keys(byYear).map(Number).sort();
  const maxY = Math.max(...years.map((y) => byYear[y]), 1);
  const ladderHtml = years.length >= 2 ? `<div class="pro-block"><div class="pro-h">차입 만기 사다리</div><div class="pro-ladder">${years.map((y) => `<div class="lr"><span class="ly">${y}</span><div class="lbar"><i style="width:${Math.max(4, byYear[y] / maxY * 100)}%"></i></div><span class="lv">${esc(fmtEok(byYear[y]))}</span></div>`).join('')}</div><p class="pro-cap">만기 명시된 차입·사채 기준 합산(억원)</p></div>` : '';

  const riskBadge = risk ? `<div class="pro-risk risk-${esc(risk.level)}"><b>⚠ ${esc(risk.label)}</b>${risk.note ? ` <span>${esc(risk.note)}</span>` : ''}</div>` : '';
  const mixHtml = assetMixBar(d);
  const tenantHtml = tenantBar(d, facts);
  const peerHtml = peerCompare(r);
  const grid1 = (divHtml || ladderHtml) ? `<div class="pro-grid2">${divHtml}${ladderHtml}</div>` : '';
  const grid2 = (mixHtml || tenantHtml) ? `<div class="pro-grid2">${mixHtml}${tenantHtml}</div>` : '';

  if (!kpiHtml && !gaugeHtml && !grid1 && !grid2 && !peerHtml) return '';
  return `
  <div class="card pro">
    <div class="facts-head"><h2 style="margin:0;font-size:18px">한눈에 보기</h2><span class="pro-tag">핵심 지표 요약</span></div>
    ${srcCap ? `<p class="pro-src">${srcCap}</p>` : ''}
    ${riskBadge}
    ${healthChip(r.ticker)}
    ${kpiHtml}
    ${gaugeHtml}
    ${grid1}
    ${grid2}
    ${peerHtml}
  </div>`;
}

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

// 스크롤 고정 KPI 바: 종목명 + 건강신호 + 핵심 칩(배당·LTV·임대율)
function stickyBar(r) {
  const d = DETAIL_BY_TICKER[r.ticker];
  const h = healthOf(r.ticker); const dot = { ok: '🟢', warn: '🟡', risk: '🔴' }[h.level];
  const ltv = numLTV(r.ticker), occ = numOcc(r.ticker);
  const yld = d && d.dividends && _pct(d.dividends.yield);
  const chips = [yld != null && `배당 ${yld}%`, ltv != null && `LTV ${ltv}%`, occ != null && `임대 ${occ}%`].filter(Boolean);
  if (!d && !chips.length) return '';
  return `  <div class="sticky-kpi"><span class="sk-nm">${dot} ${esc(r.name)}</span><span class="sk-chips">${chips.map((c) => `<span>${esc(c)}</span>`).join('')}</span><a class="sk-home" href="../../">홈</a></div>`;
}

function page(r) {
  const url = BASE + '/r/' + r.ticker + '/';
  const pro = proDashboard(r);
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
.pro{background:linear-gradient(180deg,#fbfcff,#fff)}
.pro-tag{font-size:11px;font-weight:800;color:var(--brand);background:var(--tint);border-radius:999px;padding:3px 10px}
.pro-risk{margin:10px 0 0;padding:10px 14px;border-radius:12px;font-size:13px;line-height:1.5}
.pro-risk b{font-weight:900}.pro-risk span{opacity:.9}
.pro-risk.risk-high{background:#fdecea;border:1px solid #f3c0ba;color:#b42318}
.pro-risk.risk-caution{background:#fdf6e3;border:1px solid #f2e0a8;color:#9a6700}
.pro-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}
@media(max-width:380px){.pro-kpis{grid-template-columns:repeat(2,1fr)}}
.pro-kpi{border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:#fff}
.pk-k{font-size:11px;color:var(--muted);font-weight:700}
.pk-v{font-size:16px;font-weight:900;letter-spacing:-.02em;margin-top:3px;line-height:1.25}
.pk-v.tn-good{color:#0c7a54}.pk-v.tn-warn{color:#9a6700}.pk-v.tn-bad{color:#b42318}
a.pcn{color:var(--brand);text-decoration:none}
a.pcn:hover{text-decoration:underline}
.pro-gauges{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px}
@media(max-width:520px){.pro-gauges{grid-template-columns:1fr}}
.pg-top{display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:5px}.pg-top b{font-weight:900}
.pg-bar{height:9px;border-radius:999px;background:var(--soft);overflow:hidden}
.pg-bar i{display:block;height:100%;border-radius:999px}
.pg-bar i.g-ok{background:linear-gradient(90deg,#0c9b69,#33c08a)}
.pg-bar i.g-warn{background:linear-gradient(90deg,#e0892b,#f0b24b)}
.pro-grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}
@media(max-width:560px){.pro-grid2{grid-template-columns:1fr}}
.pro-block{border:1px solid var(--line);border-radius:12px;padding:12px;background:#fff}
.pro-h{font-size:13px;font-weight:800;margin-bottom:10px}
.pro-cap{font-size:10.5px;color:var(--muted);margin:8px 0 0}
.pro-bars{display:flex;align-items:flex-end;gap:8px;height:120px}
.pro-bars .bar{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;gap:3px}
.pro-bars .bar i{display:block;width:70%;max-width:34px;background:linear-gradient(180deg,#3254ff,#6f86ff);border-radius:6px 6px 0 0;min-height:8px}
.pro-bars .bv{font-size:11px;font-weight:800}
.pro-bars .bl{font-size:10px;color:var(--muted);text-align:center;line-height:1.2}
.pro-ladder{display:flex;flex-direction:column;gap:7px}
.pro-ladder .lr{display:grid;grid-template-columns:42px 1fr auto;align-items:center;gap:8px;font-size:12px}
.pro-ladder .ly{color:var(--muted);font-weight:700}
.pro-ladder .lbar{height:14px;background:var(--soft);border-radius:6px;overflow:hidden}
.pro-ladder .lbar i{display:block;height:100%;background:linear-gradient(90deg,#3254ff,#7d93ff);border-radius:6px}
.pro-ladder .lv{font-weight:800;white-space:nowrap}
.sticky-kpi{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:rgba(255,255,255,.96);backdrop-filter:saturate(1.2) blur(6px);border:1px solid var(--line);border-radius:12px;padding:7px 11px;margin:6px 0 2px;box-shadow:0 4px 14px rgba(22,34,64,.06)}
.sticky-kpi .sk-nm{font-weight:900;font-size:13px;letter-spacing:-.02em}
.sticky-kpi .sk-chips{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto}
.sticky-kpi .sk-chips span{font-size:11.5px;font-weight:800;color:var(--text);background:var(--soft);border-radius:999px;padding:2px 9px}
.sticky-kpi .sk-home{font-size:11.5px;font-weight:800;color:var(--brand);text-decoration:none;border:1px solid var(--line);border-radius:999px;padding:2px 9px}
.pro-health{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;margin-top:12px;padding:9px 12px;border-radius:10px;font-size:13px}
.pro-health .hh b{font-weight:900}.pro-health .hr{color:inherit;opacity:.92;font-weight:700}
.pro-health .hn{margin-left:auto;font-size:10.5px;opacity:.7;font-weight:600}
.pro-health.h-ok{background:var(--okt);color:#0c7a54}
.pro-health.h-warn{background:#fdf6e3;color:#9a6700}
.pro-health.h-risk{background:#fdecea;color:#b42318}
.pro-stack{display:flex;height:16px;border-radius:6px;overflow:hidden;background:var(--soft)}
.pro-stack i{display:block;height:100%}
.pro-legend{display:flex;flex-wrap:wrap;gap:8px 12px;margin-top:8px;font-size:11.5px;color:var(--muted);font-weight:700}
.pro-legend .lg{display:inline-flex;align-items:center;gap:4px}
.pro-legend .lg i{width:10px;height:10px;border-radius:3px;display:inline-block}
.pc-wide{margin-top:14px}
.pchead{display:grid;grid-template-columns:1fr 90px 48px;gap:8px;font-size:11px;color:var(--muted);font-weight:800;padding:0 2px 4px}
.pchead .pco,.pchead .pcl{text-align:right}
.pcrow{display:grid;grid-template-columns:1fr 90px 48px;gap:8px;align-items:center;font-size:12.5px;padding:4px 2px;border-top:1px solid var(--soft)}
.pcrow.me{background:var(--tint);border-radius:8px}
.pcrow .pcn{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pcrow .pcn em{color:var(--brand);font-style:normal;font-weight:800;font-size:11px}
.pcrow .pcbar{height:10px;background:var(--soft);border-radius:5px;overflow:hidden}
.pcrow .pcbar i{display:block;height:100%;background:linear-gradient(90deg,#3254ff,#7d93ff);border-radius:5px}
.pcrow.me .pcbar i{background:linear-gradient(90deg,#e0892b,#f0b24b)}
.pcrow .pcv,.pcrow .pco{text-align:right;font-weight:800;font-variant-numeric:tabular-nums}
.pcrow .pcv.na{color:var(--muted)}
.pcrow.avg{font-weight:800;border-top:2px solid var(--line);background:var(--soft);margin-top:2px;border-radius:6px}
.pcrow.avg .pcbar{background:transparent}
.pcrow.avg .pcbar i{background:linear-gradient(90deg,#8aa0c8,#b9c6e0)}
.pcrow .pcbar{grid-column:auto}
.pcrow{grid-template-columns:1fr 64px 46px 46px}
.pchead{grid-template-columns:1fr 64px 46px 46px}
.rd-full{margin-top:14px;border-top:1px dashed var(--line);padding-top:10px}
.rd-full>summary{cursor:pointer;font-weight:800;font-size:14px;color:var(--brand);list-style:none}
.rd-full>summary::-webkit-details-marker{display:none}
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
${stickyBar(r)}
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
${pro}
${pro
    ? `<details class="rd-full"><summary>📄 투자보고서 전체 상세 펼치기</summary>${reportDetail(r)}</details>`
    : (reportDetail(r) || reportSection(r))}
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
