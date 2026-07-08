// SSG: 종목별 정적 페이지 생성기.
// index.html에 박힌 seed-data(상장리츠 25개)를 읽어 /r/<ticker>/index.html 를 만들고 sitemap.xml 갱신.
// GitHub Actions cron(또는 `node scripts/build-pages.mjs`)으로 주기 재생성.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { dividendDisplay, week52Position, navDisplay } from '../assets/js/reit-metrics.mjs';
import { sparklineSvg } from './lib/price-display.mjs';
import { sustainabilitySignals, signalCounts } from './lib/sustainability.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://seonghoonkim2.github.io/reits-on';
const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
const NOW_MONTH = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', month: 'numeric' }).format(new Date()));
// 다음 배당기준월(빌드 시점 KST 기준). divMonths 중 이번달 이상 최소값, 없으면 최소값.
function nextDivMonth(divMonths) {
  if (!Array.isArray(divMonths) || !divMonths.length) return null;
  const s = divMonths.slice().sort((a, b) => a - b);
  return s.find((m) => m >= NOW_MONTH) ?? s[0];
}
// 다음 배당기준월 말일까지 D-day(KST). 매일 재빌드되므로 빌드 시점 계산으로 충분.
const KST_NOW = new Date(Date.now() + 9 * 3600 * 1000);
function dDayToMonthEnd(m) {
  const y = KST_NOW.getUTCFullYear() + (m < NOW_MONTH ? 1 : 0);
  const end = Date.UTC(y, m, 0);   // m월 말일
  const today = Date.UTC(KST_NOW.getUTCFullYear(), KST_NOW.getUTCMonth(), KST_NOW.getUTCDate());
  return Math.round((end - today) / 86400000);
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (t) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[t]));
const fmt = (n) => Number(n).toLocaleString('ko-KR');

// 섹터 랜딩(/s/{slug}/) 메타: primary(한글) → {slug, 검색어, 소개, 확인 포인트}. 추천·순위 아님(교육).
const SECTOR_META = {
  '오피스': { slug: 'office', lead: '도심 오피스 빌딩을 임대해 임대료로 배당을 만드는 리츠입니다.', points: ['공실률과 재계약 임대료(리싱 스프레드)의 방향', '차입금 금리·리파이낸싱(만기 재조달) 일정과 조건', '스폰서·앵커 임차인의 임대차 만기와 신용도'] },
  '해외': { slug: 'overseas', lead: '해외 부동산에 투자하는 리츠로, 환율과 현지 시장이 배당·자산가치를 좌우합니다.', points: ['원화 환율 변동(환헤지 여부·비용 포함)', '현지 금리·자산가치·리파이낸싱 조건', '현지 임차인 신용도와 임대차 구조'] },
  '물류': { slug: 'logistics', lead: '물류센터를 임대하는 리츠입니다. 전자상거래 성장과 신규 공급이 핵심 변수입니다.', points: ['임차인 분산도와 주요 임차인 신용도', '해당 권역 신규 물류센터 공급 물량', '임대료 재계약(리싱) 조건과 공실 위험'] },
  '복합': { slug: 'mixed', lead: '오피스·물류·리테일 등 여러 유형 자산을 함께 담은 리츠입니다.', points: ['자산별 성과 편차와 비중', '자산별 임대차 만기·차입금 만기의 분산 정도', '특정 자산 매각·편입에 따른 배당 변동 가능성'] },
  '인프라': { slug: 'infra', lead: '생활 인프라·리테일 성격 자산을 담아 장기 임대차로 배당을 만드는 리츠입니다.', points: ['장기 임대차(마스터리스) 구조와 잔여 기간', '임차인 업태 전환·매출 안정성', '물가연동 임대료 조항 여부'] },
  '리테일': { slug: 'retail', lead: '백화점·마트 등 리테일 자산을 임대하는 리츠입니다. 소비 경기에 민감합니다.', points: ['핵심 임차인의 매출·영업 안정성과 신용도', '소비 경기와 오프라인 리테일 업황', '장기 임대차(마스터리스) 구조와 잔여 기간'] },
  '주거': { slug: 'resi', lead: '임대주택 등 주거 자산을 운용하는 리츠입니다.', points: ['임대율과 임대료 상승 여력', '주택 매매·전월세 시장과 정책 변화', '자산 매각 계획과 개발 단계 위험'] },
  '호텔': { slug: 'hotel', lead: '호텔 자산을 담은 리츠입니다. 객실 수요와 가동률이 실적을 좌우합니다.', points: ['객실 가동률·객단가(ADR)와 관광 수요', '임대차(고정임대료) 구조 여부', '배당 재개·중단 여부와 재무 안정성'] },
};

// ---- seed 추출 ----
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const m = html.match(/<script id="seed-data" type="application\/json">([\s\S]*?)<\/script>/);
if (!m) { console.error('seed-data를 찾지 못했습니다.'); process.exit(1); }
const seed = JSON.parse(m[1]);
const REITS = seed.reits;

// ---- 일별 종가 시계열(스파크라인용). 없으면 빈 객체 ----
let PRICE_HISTORY = {};
try { PRICE_HISTORY = (JSON.parse(readFileSync(join(ROOT, 'data', 'price-history.json'), 'utf8')).series) || {}; } catch { /* 없으면 스킵 */ }

// ---- 상장 인프라펀드(리츠 아님) — 별도 데이터·별도 템플릿 ----
let INFRA = [];
try { INFRA = (JSON.parse(readFileSync(join(ROOT, 'data', 'infra.json'), 'utf8')).infra) || []; } catch { /* 없으면 스킵 */ }

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
  if (/호텔|숙박/.test(u)) return '호텔';
  if (/주거|임대주택|코리빙|학생|멀티패밀리|레지던스/.test(u)) return '주거';
  if (/개발/.test(u)) return '개발';
  if (/백화점|아울렛|마트|쇼핑/.test(u)) return '리테일';        // 강한 리테일 신호
  if (/오피스|업무/.test(u)) return '오피스';                    // '오피스·판매' 등 복합은 오피스 우선
  if (/리테일|판매|상가|점포|근린/.test(u)) return '리테일';     // 순수 상업시설
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
  // 후보 가중치를 만든다: 자산별 (가액 또는 null) 배열. null=가액 미공시.
  let weights = null, basisLabel = '개수', covered = assets.length;
  // 0) 구조화된 가액 필드(assets[].aum, 억원)가 모든 자산에 있으면 우선 사용(가장 정확)
  if (assets.every((a) => typeof a.aum === 'number' && a.aum > 0)) {
    weights = assets.map((a) => a.aum);
    basisLabel = (d.assetBasis && String(d.assetBasis)) || '가액';
  } else {
    // 1) note 문자열에서 동일 기준 가액 파싱(감정가>평가액>매입가>임대료). 전부 잡히면 채택,
    //    아니면 '다수(70%+)'가 잡히는 기준 중 커버리지가 가장 높은 것을 부분 채택(미공시 자산은 명시 후 제외).
    let best = null;
    for (const [re, label] of [['감정평가|감정가|감정', '감정가'], ['당기말|평가액|장부가|공정가', '평가액'], ['매입가|매입|취득가|취득|투자금액|투자|순매입', '매입가'], ['연임대료|임대료', '연임대료']]) {
      const vals = assets.map((a) => valNear(a.note, re));
      const cov = vals.filter((v) => v != null && v > 0).length;
      if (cov === assets.length) { weights = vals; basisLabel = label; covered = cov; best = null; break; }
      if (cov >= 2 && cov / assets.length >= 0.7 && (!best || cov > best.cov)) best = { vals, label, cov };
    }
    if (!weights && best) {
      weights = best.vals.map((v) => (v != null && v > 0) ? v : null);
      basisLabel = best.label; covered = best.cov;
    }
  }
  const valueMode = !!weights;
  const agg = {};
  assets.forEach((a, i) => {
    const wi = valueMode ? weights[i] : 1;
    if (wi == null) return; // 부분 커버리지: 가액 미공시 자산은 비중 계산에서 제외(라벨로 명시)
    const ty = assetTypeOf((a.use || '') + ' ' + (a.name || ''));
    agg[ty] = (agg[ty] || 0) + wi;
  });
  const entries = Object.entries(agg).sort((a, b) => b[1] - a[1]);
  if (entries.length < 2) return '';
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
  const lab = (v) => valueMode ? esc(fmtEok(v)) : v + '개';
  const seg = entries.map(([ty, v]) => `<i style="width:${(v / total * 100).toFixed(1)}%;background:${ASSET_COLORS[ty] || '#94a3b8'}" title="${esc(ty)} ${lab(v)} (${(v / total * 100).toFixed(0)}%)"></i>`).join('');
  const leg = entries.map(([ty, v]) => `<span class="lg"><i style="background:${ASSET_COLORS[ty] || '#94a3b8'}"></i>${esc(ty)} ${(v / total * 100).toFixed(0)}%</span>`).join('');
  const aria = entries.map(([ty, v]) => `${ty} ${(v / total * 100).toFixed(0)}%`).join(', ');
  const partial = valueMode && covered < assets.length ? ` · 공시 ${covered}/${assets.length}` : '';
  return `<div class="pro-block"><div class="pro-h">자산군 구성 (${assets.length}개 · ${basisLabel} 기준${partial})</div><div class="pro-stack" role="img" aria-label="자산군 구성 — ${esc(aria)}">${seg}</div><div class="pro-legend">${leg}</div></div>`;
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
    const barI = x.ltv != null ? `<i style="width:${Math.max(3, x.ltv / maxLtv * 100)}%"></i>` : '';
    return `<div class="pcrow${me ? ' me' : ''}" data-ltv="${x.ltv ?? ''}" data-occ="${x.occ ?? ''}">${nameCell}<div class="pcbar">${barI}</div><span class="pcv${x.ltv == null ? ' na' : ''}">${x.ltv != null ? x.ltv + '%' : '–'}</span><span class="pco${x.occ == null ? ' na' : ''}">${x.occ != null ? x.occ + '%' : '–'}</span></div>`;
  }).join('');
  const rankTxt = myIdx >= 0 ? ` · 이 종목 LTV ${myIdx + 1}위/${ranked.length}` : '';
  const avgRow = `<div class="pcrow avg" data-ltv="${avgL ?? ''}" data-occ="${avgO ?? ''}"><span class="pcn">그룹 평균</span><div class="pcbar">${avgL != null ? `<i style="width:${Math.max(3, avgL / maxLtv * 100)}%"></i>` : ''}</div><span class="pcv">${avgL != null ? avgL + '%' : '–'}</span><span class="pco">${avgO != null ? avgO + '%' : '–'}</span></div>`;
  return `<div class="pro-block pc-wide"><div class="pro-h">동일 자산군 비교 · ${esc(meta.primary)} (${rows.length}종)${rankTxt}</div>
    <div class="pcbtns">막대 기준 <button type="button" class="pcbtn on" data-metric="ltv">LTV</button><button type="button" class="pcbtn" data-metric="occ">임대율</button></div>
    <div class="pchead"><span class="pcn">종목</span><span class="pcbarh">막대</span><span class="pcl">LTV ↓</span><span class="pco">임대율</span></div>
    <div class="pcbody">${body}${avgRow}</div>
    <p class="pro-cap">막대=선택 지표 기준 정렬, 두 값 컬럼은 항상 표시. 정의·기준일 상이 가능, 임대율은 일부 단일자산 기준.</p></div>`;
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
  const KPI_TIP = { 'LTV': '담보인정비율 = 총차입금 ÷ 자산(또는 감정가). 높을수록 레버리지·금리 민감도 ↑', 'WALE': '가중평균 잔여임대차기간(년). 길수록 임대수익 안정', '임대율': '임대된 면적 비율(=100%−공실률)', '배당수익률': '주가 대비 배당 비율. 분기/반기/연 기준이 종목마다 다름', '최근 주당배당': '최근 1회 주당 현금배당금(원)', '신용등급': '발행 회사채 또는 기업신용등급(ICR)' };
  const kpiHtml = kpis.length ? `<div class="pro-kpis">${kpis.map((x) => `<div class="pro-kpi"><div class="pk-k"${KPI_TIP[x.k] ? ` title="${esc(KPI_TIP[x.k])}"` : ''}>${esc(x.k)}${KPI_TIP[x.k] ? ' <span class="pk-i">ⓘ</span>' : ''}</div><div class="pk-v${x.t ? ' tn-' + x.t : ''}">${esc(x.v)}</div></div>`).join('')}</div>` : '';
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
  const byYear = {}; let totalDebt = 0, due12 = 0, wsum = 0, wamt = 0;
  const asOf = d.asOf ? new Date(d.asOf) : null;
  const cutoff = asOf ? new Date(asOf.getFullYear() + 1, asOf.getMonth(), asOf.getDate()) : null;
  const pdate = (s) => { const m = String(s || '').match(/(20\d\d)-(\d{2})(?:-(\d{2}))?/); return m ? new Date(+m[1], +m[2] - 1, +(m[3] || 1)) : null; };
  items.forEach((it) => {
    const y = _year(it.maturity); const a = _eok(it.amount);
    if (!a) return;
    totalDebt += a; if (y) byYear[y] = (byYear[y] || 0) + a;
    const md = pdate(it.maturity); if (asOf && cutoff && md && md >= asOf && md <= cutoff) due12 += a;
    const r = _pct(it.rate); if (r != null && it.rateType !== '변동') { wsum += a * r; wamt += a; }
  });
  const years = Object.keys(byYear).map(Number).sort();
  const maxY = Math.max(...years.map((y) => byYear[y]), 1);
  const wavg = wamt ? Math.round(wsum / wamt * 100) / 100 : null;
  const nowY = asOf ? asOf.getFullYear() : null;
  const due12Html = (asOf && due12 > 0 && totalDebt > 0) ? `<div class="ladder-due">⏱ 향후 12개월 내 만기 <b>${esc(fmtEok(due12))}</b> <span>(만기명시 차입의 ${Math.round(due12 / totalDebt * 100)}%)</span></div>` : '';
  const ladderHtml = years.length >= 2 ? `<div class="pro-block"><div class="pro-h">차입 만기 사다리</div>${due12Html}<div class="pro-ladder">${years.map((y) => `<div class="lr${nowY && (y === nowY || y === nowY + 1) ? ' near' : ''}"><span class="ly">${y}</span><div class="lbar"><i style="width:${Math.max(4, byYear[y] / maxY * 100)}%"></i></div><span class="lv">${esc(fmtEok(byYear[y]))}</span></div>`).join('')}</div><p class="pro-cap">만기 명시 차입·사채 합산${wavg != null ? ` · 고정분 가중평균 금리 약 ${wavg}%` : ''}</p></div>` : '';

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

// 첫 화면 '3숫자' 스트립: 실배당 TTM · P/NAV · 다음 배당월 (네이버·증권사앱에 없는 차별화 숫자)
function numStrip(r) {
  const d = dividendDisplay(r, r.price);
  const nv = navDisplay(r.navPerShare, r.price);
  const nm = nextDivMonth(r.divMonths);
  const cells = [];
  if (d.show && d.isDiv && d.yield != null) cells.push({ k: '실배당수익률<span class="ns-t">TTM·실적</span>', v: d.yield + '%', sub: d.badge !== '실적' ? d.badge : '공시 실지급 기준', tone: d.tone });
  else if (d.show && !d.isDiv) cells.push({ k: '실배당수익률', v: '무배당', sub: '최근 12개월', tone: 'warn' });
  if (nv) cells.push({ k: 'P/NAV<span class="ns-t">장부 순자산</span>', v: nv.pnav + '배', sub: (nv.premium ? '할증 ' + Math.abs(nv.discountPct) : '할인 ' + nv.discountPct) + '%', tone: '' });
  if (nm) {
    const dd = dDayToMonthEnd(nm);
    cells.push({ k: '다음 배당기준월<span class="ns-t">말일 가정·예상</span>', v: nm + '월', sub: (dd >= 0 ? 'D-' + dd + ' · ' : '') + r.divMonths.map((m) => m + '월').join('·'), tone: '' });
  }
  if (cells.length < 2) return '';
  return `<div class="numstrip">${cells.map((c) => `<div class="ns-cell"><div class="ns-k">${c.k}</div><div class="ns-v${c.tone ? ' t-' + c.tone : ''}">${c.v}</div><div class="ns-sub">${esc(c.sub)}</div></div>`).join('')}</div>`;
}

// 회차별 배당금 추이 막대차트(주당·공시 실적). 특별배당 구분색·감소 표시.
function dividendHistoryChart(r) {
  const s = Array.isArray(r.divHistory) ? r.divHistory : [];
  if (s.length < 2) return '';
  const max = Math.max(...s.map((x) => x.value), 1);
  const bars = s.map((x) => {
    const h = Math.max(2, Math.round((x.value / max) * 100));
    const cls = x.value === 0 ? 'zero' : x.special ? 'sp' : 'reg';
    const vlab = x.value === 0 ? '무배당' : (fmt(x.value) + (x.approx ? '≈' : ''));
    return `<div class="dvh-bar"><div class="dvh-v">${esc(vlab)}</div><i class="${cls}" style="height:${h}%"></i><div class="dvh-l">${esc(x.period)}</div></div>`;
  }).join('');
  // 최근 vs 직전 회차 변화(무배당 제외 값끼리)
  const vals = s.map((x) => x.value);
  const last = vals[vals.length - 1], prev = vals[vals.length - 2];
  let trend = '';
  if (last != null && prev != null && prev > 0 && last !== prev) {
    const dn = last < prev;
    trend = `<span class="dvh-trend ${dn ? 'dn' : 'up'}">최근 ${dn ? '↓ 감소' : '↑ 증가'} ${prev}→${last}원</span>`;
  }
  const hasSp = s.some((x) => x.special);
  return `<div class="card dvh-card">
    <div class="dvh-h">회차별 배당금 추이 <span class="sub">주당·공시 실적</span>${trend}</div>
    <div class="dvh-bars">${bars}</div>
    <div class="dvh-legend"><span class="lg reg">경상 배당</span>${hasSp ? '<span class="lg sp">특별배당(일회성)</span>' : ''}<span class="dvh-note">회차(기)별 공시 주당배당금. 특별배당은 자산 처분 등 일회성으로 반복성이 낮습니다.</span></div>
  </div>`;
}

// 히어로 시세·실배당수익률·52주·스파크라인 블록(빌드 시점 스냅샷, 실시간 아님)
function metricsBlock(r) {
  if (r.price == null && !dividendDisplay(r, r.price).show) return '';
  const cp = r.changePct;
  const chgCol = cp > 0 ? '#d1453b' : cp < 0 ? '#1f6feb' : 'var(--muted)';
  const chg = (cp != null) ? ` <span style="color:${chgCol};font-weight:800">${cp > 0 ? '+' : ''}${cp}%</span>` : '';
  const priceRow = (r.price != null)
    ? `<div class="mx-row"><span class="mx-k">현재가</span><span class="mx-v"><b>${fmt(r.price)}원</b>${chg} <span class="mx-note">실시간 아님${r.priceAsOf ? ' · ' + esc(r.priceAsOf) + ' 종가' : ''}</span></span></div>`
    : '';

  // 실배당수익률(TTM)
  const d = dividendDisplay(r, r.price);
  let ttmRow = '';
  if (d.show) {
    if (!d.isDiv) {
      ttmRow = `<div class="mx-row"><span class="mx-k">실배당수익률</span><span class="mx-v"><span class="mx-badge warn">무배당</span> <span class="mx-note">${esc(d.caveats[0] || '')}</span></span></div>`;
    } else {
      const y = d.yield != null ? `<b>${d.yield}%</b>` : '<span class="mx-note">현재가 연동 시</span>';
      const cav = d.caveats.length ? `<div class="mx-cav">⚠ ${esc(d.caveats.join(' '))}</div>` : '';
      ttmRow = `<div class="mx-row"><span class="mx-k">실배당수익률<br><span class="mx-sub">최근 1년 실적</span></span><span class="mx-v">${y} <span class="mx-badge ${d.tone}">${esc(d.badge)}</span> <span class="mx-note">공시 실지급 ${fmt(d.ttmDps)}원/주</span>${cav}</span></div>`;
    }
  }

  // P/NAV(장부 순자산 기준)
  const nv = navDisplay(r.navPerShare, r.price);
  const navRow = nv
    ? `<div class="mx-row"><span class="mx-k">P/NAV<br><span class="mx-sub">장부 순자산 기준</span></span><span class="mx-v"><b>${nv.pnav}배</b> <span class="mx-badge ${nv.premium ? 'muted' : 'ok'}">${nv.premium ? '할증 ' + Math.abs(nv.discountPct) + '%' : '할인 ' + nv.discountPct + '%'}</span> <span class="mx-note">주당 순자산 ${fmt(r.navPerShare)}원</span><div class="mx-cav">감정 공정가치는 장부보다 큰 경우가 많아 실제 할인폭은 더 클 수 있어요.</div></span></div>`
    : '';

  // 52주 범위 + 위치 바
  const p52 = week52Position(r.price, r.week52Low, r.week52High);
  const w52Row = p52
    ? `<div class="mx-row"><span class="mx-k">52주 범위</span><span class="mx-v">${fmt(r.week52Low)} ~ ${fmt(r.week52High)}원 <span class="mx-w52"><i style="left:${p52.posPct}%"></i></span><span class="mx-note">저점 대비 +${p52.fromLowPct}% · 고점 대비 −${p52.offHighPct}%</span></span></div>`
    : '';

  // 스파크라인(최근 1년, 빌드 시점 인라인 SVG)
  const spark = sparklineSvg(PRICE_HISTORY[r.ticker], { w: 260, h: 46 });
  const sparkRow = spark ? `<div class="mx-spark">${spark}<span class="mx-note">최근 1년 주가</span></div>` : '';

  if (!priceRow && !ttmRow && !w52Row && !navRow) return '';
  return `<div class="mx">${priceRow}${ttmRow}${navRow}${w52Row}${sparkRow}</div>`;
}

// 배당 지속가능성 점검: 종합점수·추천이 아니라, 배당에 영향을 줄 수 있는 공시 '사실'을 규칙으로 모아
// 레벨(살펴볼 점/확인 필요/양호/미확인) + 근거 + 출처로 나열. 판단은 이용자 몫.
const SUS_META = {
  alert: ['❗', '확인 필요', 'sus-alert'],
  watch: ['⚠', '살펴볼 점', 'sus-watch'],
  ok: ['✓', '양호', 'sus-ok'],
  na: ['—', '공시 미확인', 'sus-na'],
};
function sustainabilityCard(r) {
  const facts = FACTS_BY_TICKER[r.ticker];
  const detail = DETAIL_BY_TICKER[r.ticker];
  const signals = sustainabilitySignals(r, facts, detail);
  if (!signals.length) return '';
  // 정렬: alert → watch → ok → na
  const order = { alert: 0, watch: 1, ok: 2, na: 3 };
  signals.sort((a, b) => order[a.level] - order[b.level]);
  const c = signalCounts(signals);
  const chips = [];
  if (c.alert) chips.push(`<span class="sus-chip sus-alert">확인 필요 ${c.alert}</span>`);
  if (c.watch) chips.push(`<span class="sus-chip sus-watch">살펴볼 점 ${c.watch}</span>`);
  if (c.ok) chips.push(`<span class="sus-chip sus-ok">양호 ${c.ok}</span>`);
  if (c.na) chips.push(`<span class="sus-chip sus-na">미확인 ${c.na}</span>`);
  const rows = signals.map((s) => {
    const [icon, , cls] = SUS_META[s.level] || SUS_META.na;
    const src = s.source ? ` <a class="sus-src" href="${esc(s.source)}" target="_blank" rel="noopener">출처${s.asOf ? '·' + esc(s.asOf) : ''} →</a>` : '';
    return `<div class="sus-row ${cls}"><span class="sus-ic">${icon}</span><div class="sus-b"><div class="sus-l">${esc(s.label)}</div><div class="sus-t">${esc(s.text)}${src}</div></div></div>`;
  }).join('');
  return `<div class="card sus">
    <div class="facts-head"><h2 style="margin:0;font-size:18px">배당 지속가능성 점검</h2><span class="sus-tag">점수·추천 아님</span></div>
    <p class="sub" style="margin:0 0 10px">종합점수나 매수 판단이 아니라, <b>배당에 영향을 줄 수 있는 공시 사실</b>을 규칙으로 모은 것입니다. 각 항목은 사실이며 근거·출처를 함께 봅니다. 최종 판단은 직접 하세요.</p>
    <div class="sus-chips">${chips.join('')}</div>
    <div class="sus-list">${rows}</div>
  </div>`;
}

function page(r) {
  const url = BASE + '/r/' + r.ticker + '/';
  const pro = proDashboard(r);
  // 연 배당은 실적(TTM) 우선. 이력 없으면 recentDiv×횟수로 폴백.
  const annual = (r.ttmDps != null && r.ttmDps > 0) ? r.ttmDps : (r.recentDiv ? r.recentDiv * r.divMonths.length : null);
  const annualIsTtm = (r.ttmDps != null && r.ttmDps > 0);
  const title = `${r.name} (${r.ticker}) 배당·정보 | 리츠온 REITs ON`;
  const desc = `${r.name}: ${r.primary} 상장리츠. 배당기준월 ${r.divMonths.map(x=>x+'월').join('·')}, ${freqLabel(r.divMonths.length)}` + (annual ? `, 연환산 추정 배당 약 ${fmt(annual)}원/주.` : '.') + ' 배당월·자산·확인 포인트를 한눈에. (교육용 정보, 투자 권유 아님)';
  const monthCells = MONTHS.map((lab,i)=>`<span class="mc${r.divMonths.includes(i+1)?' on':''}">${i+1}</span>`).join('');
  const naverUrl = naver(r.ticker);
  const priceLine = metricsBlock(r);
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
<meta property="og:image" content="${url}og.png" />
<meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" /><meta name="twitter:image" content="${url}og.png" />
<meta name="twitter:image" content="${BASE}/og.png" />
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<style>
:root{--brand:#3254ff;--bg:#f5f7fb;--surface:#fff;--text:#172033;--muted:#515b72;--line:#e5e9f2;--soft:#eef1f7;--tint:#edf1ff;--ok:#0c9b69;--okt:#e4f5ec}
*{box-sizing:border-box}body{margin:0;font-family:'Pretendard','Apple SD Gothic Neo','Malgun Gothic',system-ui,sans-serif;background:var(--bg);color:var(--text);line-height:1.6}
.wrap{max-width:760px;margin:0 auto;padding:20px 18px 60px}
.top{display:flex;align-items:center;gap:10px;padding:14px 0}
.logo{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#3254ff,#00a78e);color:#fff;font-weight:900;display:grid;place-items:center;text-decoration:none}
.top a.brand{color:var(--text);text-decoration:none;font-weight:800}
.top .topfacts{margin-left:auto;font-size:12.5px;font-weight:700;color:var(--brand);text-decoration:none;background:var(--tint);border-radius:999px;padding:6px 12px}
.eyebrow{display:inline-block;font-size:12px;font-weight:800;color:var(--brand);background:var(--tint);border-radius:999px;padding:5px 12px}
.risk-banner{margin:12px 0 0;padding:10px 14px;border-radius:12px;font-size:13.5px;line-height:1.5}
.risk-banner b{font-weight:900}.risk-banner span{color:inherit;opacity:.9}
.risk-banner.risk-high{background:#fdecea;border:1px solid #f3c0ba;color:#b42318}
.risk-banner.risk-caution{background:#fdf6e3;border:1px solid #f2e0a8;color:#9a6700}
h1{font-size:28px;letter-spacing:-1px;margin:14px 0 4px}
.tk{color:var(--muted);font-weight:700}
.toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:12px 0 2px}
.tbtn{font:inherit;font-size:13px;font-weight:800;color:var(--text);background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:8px 14px;cursor:pointer}
.tbtn:hover{border-color:#c9d3ee}
.tbtn.on{color:#9a6700;background:#fdf6e3;border-color:#f2e0a8}
.tjump{margin-left:auto}
.tjump select{font:inherit;font-size:13px;font-weight:700;color:var(--muted);background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:8px 12px;max-width:170px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.icsl{color:var(--brand);text-decoration:none;font-weight:700}
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
.pk-i{font-size:9px;color:var(--muted);cursor:help;opacity:.7}
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
.ladder-due{font-size:12.5px;font-weight:800;color:#9a6700;background:#fdf6e3;border:1px solid #f2e0a8;border-radius:8px;padding:6px 10px;margin:0 0 10px}
.ladder-due b{font-weight:900}.ladder-due span{font-weight:600;opacity:.85}
.pro-ladder{display:flex;flex-direction:column;gap:7px}
.pro-ladder .lr.near .lbar i{background:linear-gradient(90deg,#e0892b,#f0b24b)}
.pro-ladder .lr.near .ly{color:#9a6700}
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
.pcbtns{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted);font-weight:700;margin:0 0 8px}
.pcbtn{font-size:11.5px;font-weight:800;border:1px solid var(--line);background:var(--surface);color:var(--muted);border-radius:999px;padding:3px 10px;cursor:pointer}
.pcbtn.on{background:var(--brand);color:#fff;border-color:var(--brand)}
.pcbarh{font-size:11px;color:var(--muted);font-weight:800}
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
.mx{margin-top:12px;border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:linear-gradient(180deg,#fbfcff,#fff);display:grid;gap:8px}
.mx-row{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;font-size:14px}
.mx-k{color:var(--muted);font-weight:700;flex:0 0 auto}
.mx-sub{font-size:10.5px;font-weight:600;opacity:.8}
.mx-v{text-align:right;font-weight:650}
.mx-v b{font-size:16px}
.mx-note{color:var(--muted);font-size:11.5px;font-weight:600}
.mx-cav{color:#9a6700;font-size:11.5px;font-weight:600;margin-top:3px;max-width:280px;margin-left:auto}
.mx-badge{display:inline-block;font-size:10.5px;font-weight:800;border-radius:6px;padding:1px 6px;vertical-align:middle}
.mx-badge.ok{background:var(--okt);color:var(--ok);border:1px solid var(--ok)}
.mx-badge.warn{background:#fdf6e3;color:#9a6700;border:1px solid #f2e0a8}
.mx-badge.muted{background:var(--soft);color:var(--muted);border:1px solid var(--line)}
.mx-w52{position:relative;display:inline-block;width:72px;height:6px;border-radius:999px;background:linear-gradient(90deg,#1f6feb22,#d1453b22);vertical-align:middle;margin:0 4px}
.mx-w52 i{position:absolute;top:-2px;width:3px;height:10px;border-radius:2px;background:var(--text);transform:translateX(-50%)}
.mx-spark{display:flex;align-items:center;gap:8px;border-top:1px solid var(--soft);padding-top:8px}
.mx-spark svg{max-width:100%;height:auto}
.numstrip{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0 4px}
@media(max-width:420px){.numstrip{gap:6px}}
.ns-cell{border:1px solid var(--line);border-radius:12px;padding:10px 8px;background:linear-gradient(180deg,#fbfcff,#fff);text-align:center;min-width:0}
.ns-k{font-size:10.5px;font-weight:800;color:var(--muted);line-height:1.25;display:flex;flex-direction:column;align-items:center;gap:1px}
.ns-t{font-size:9px;font-weight:700;opacity:.7}
.ns-v{font-size:20px;font-weight:950;letter-spacing:-.03em;margin:3px 0 2px;line-height:1.1}
@media(max-width:420px){.ns-v{font-size:17px}}
.ns-v.t-warn{color:#9a6700}
.ns-sub{font-size:10px;color:var(--muted);font-weight:600;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sus .sus-tag{font-size:10.5px;font-weight:800;color:var(--muted);background:var(--soft);border-radius:999px;padding:3px 9px;white-space:nowrap}
.sus-chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px}
.sus-chip{font-size:11.5px;font-weight:800;border-radius:999px;padding:4px 10px}
.sus-chip.sus-alert{color:#b42318;background:#fdecea}
.sus-chip.sus-watch{color:#9a6700;background:#fdf6e3}
.sus-chip.sus-ok{color:#0c7a54;background:#e4f5ec}
.sus-chip.sus-na{color:#5a647b;background:#eef1f7}
.sus-list{display:grid;gap:8px}
.sus-row{display:flex;gap:10px;align-items:flex-start;border:1px solid var(--line);border-radius:12px;padding:11px 13px;background:#fff}
.sus-row.sus-alert{border-color:#f3c0ba;background:#fef7f6}
.sus-row.sus-watch{border-color:#f2e0a8;background:#fefbf2}
.sus-row.sus-na{opacity:.72}
.sus-ic{flex:none;font-size:15px;line-height:1.5;width:20px;text-align:center}
.sus-row.sus-alert .sus-ic{color:#b42318}.sus-row.sus-watch .sus-ic{color:#9a6700}.sus-row.sus-ok .sus-ic{color:#0c7a54}
.sus-b{min-width:0}
.sus-l{font-size:13.5px;font-weight:800;margin-bottom:2px}
.sus-t{font-size:13px;color:var(--muted);line-height:1.5}
.sus-src{color:var(--brand);text-decoration:none;font-weight:700;white-space:nowrap}
.dvh-h{font-size:15px;font-weight:850;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dvh-h .sub{font-size:11px;font-weight:600;color:var(--muted)}
.dvh-trend{margin-left:auto;font-size:11.5px;font-weight:800;border-radius:999px;padding:2px 9px}
.dvh-trend.dn{background:#1f6feb14;color:#1f6feb}.dvh-trend.up{background:#d1453b14;color:#d1453b}
.dvh-bars{display:flex;align-items:flex-end;gap:6px;height:120px;margin:14px 0 4px;padding-top:16px}
.dvh-bar{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;gap:3px;min-width:0}
.dvh-bar i{display:block;width:72%;max-width:38px;border-radius:5px 5px 0 0;min-height:2px}
.dvh-bar i.reg{background:linear-gradient(180deg,#3254ff,#6f86ff)}
.dvh-bar i.sp{background:linear-gradient(180deg,#e0892b,#f0b24b)}
.dvh-bar i.zero{background:var(--line)}
.dvh-v{font-size:11px;font-weight:800;white-space:nowrap}
.dvh-l{font-size:10.5px;color:var(--muted);font-weight:700}
.dvh-legend{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin-top:10px;font-size:11px;color:var(--muted)}
.dvh-legend .lg{display:inline-flex;align-items:center;gap:4px;font-weight:700}
.dvh-legend .lg::before{content:"";width:10px;height:10px;border-radius:3px;display:inline-block}
.dvh-legend .lg.reg::before{background:#3254ff}.dvh-legend .lg.sp::before{background:#e0892b}
.dvh-note{flex-basis:100%;font-size:10.5px;opacity:.85}
</style>
</head>
<body>
<div class="wrap">
  <div class="top"><a class="logo" href="../../">R</a><a class="brand" href="../../">리츠온 REITs ON</a><a class="topfacts" href="../../facts.html">📊 팩트시트</a></div>
${stickyBar(r)}
  <span class="eyebrow">상장리츠 · ${esc(r.primary)}</span>
  <h1>${esc(r.name)}</h1>
  <div class="tk">종목코드 ${esc(r.ticker)} · ${esc(r.sector.join(', '))}</div>
  <div class="toolbar">
    <button class="tbtn" id="watchBtn" type="button" aria-pressed="false">☆ 관심 추가</button>
    <button class="tbtn" id="shareBtn" type="button">🔗 공유</button>
    <label class="tjump"><span class="sr">다른 리츠로 이동</span>
      <select id="jumpSel" aria-label="다른 리츠로 이동">
        <option value="">다른 리츠 보기…</option>
        ${REITS.slice().sort((a, b) => a.name.localeCompare(b.name, 'ko')).map((x) => `<option value="${x.ticker}"${x.ticker === r.ticker ? ' disabled' : ''}>${esc(x.name)}</option>`).join('')}
        ${INFRA.map((x) => `<option value="${x.ticker}">${esc(x.shortName || x.name)} (인프라)</option>`).join('')}
      </select>
    </label>
  </div>
${numStrip(r)}
${riskBanner(r)}

  <div class="card">
    <div class="hero">${annual ? fmt(annual) + `원 <span class="sub">/주 (${annualIsTtm ? '최근 1년 실적·TTM' : '연환산 추정'})</span>` : '<span class="sub">최근배당금 공시 확인 필요</span>'}</div>
    ${annual ? `<div class="sub">월 환산 약 ${fmt(Math.round(annual/12))}원/주 · ${annualIsTtm ? '최근 12개월 공시 실지급 합산' : '최근배당금 ' + fmt(r.recentDiv) + '원(1회)×' + r.divMonths.length + '회 단순 추정'}</div>` : ''}
    <div class="months" role="img" aria-label="배당기준월 ${r.divMonths.map(x=>x+'월').join(', ')}">${monthCells}</div>
    <div class="sub" style="margin-top:8px">${esc(freqLabel(r.divMonths.length))} · 배당기준월 ${r.divMonths.map(x=>x+'월').join('·')} · <a class="icsl" href="../../reits-on.ics">📅 캘린더 앱에 구독(.ics)</a></div>
    ${priceLine}
  </div>
${dividendHistoryChart(r)}
${sustainabilityCard(r)}

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
  <p class="note">${SECTOR_META[r.primary] ? `<a class="more" href="../../s/${SECTOR_META[r.primary].slug}/">${esc(r.primary)} 리츠 전체 보기 →</a> · ` : ''}<a class="more" href="../../about/">데이터 방법론·면책</a> · <a class="more" href="../../">← 리츠온 홈으로</a></p>
</div>
<script>
(function(){
  var box=document.querySelector('.pc-wide'); if(!box) return;
  var cont=box.querySelector('.pcbody'); if(!cont) return;
  var btns=[].slice.call(box.querySelectorAll('.pcbtn'));
  function render(m){
    var rs=[].slice.call(cont.querySelectorAll('.pcrow'));
    var vals=rs.filter(function(r){return !r.classList.contains('avg');})
      .map(function(r){return parseFloat(r.getAttribute('data-'+m));})
      .filter(function(v){return !isNaN(v);});
    var max=Math.max.apply(null, vals.concat([1]));
    rs.sort(function(a,b){
      if(a.classList.contains('avg'))return 1; if(b.classList.contains('avg'))return -1;
      var av=parseFloat(a.getAttribute('data-'+m)), bv=parseFloat(b.getAttribute('data-'+m));
      return (isNaN(bv)?-1:bv)-(isNaN(av)?-1:av);
    });
    rs.forEach(function(r){
      var v=parseFloat(r.getAttribute('data-'+m)); var bar=r.querySelector('.pcbar');
      if(bar) bar.innerHTML=isNaN(v)?'':'<i style="width:'+Math.max(3, v/max*100).toFixed(1)+'%"></i>';
      cont.appendChild(r);
    });
    btns.forEach(function(b){b.classList.toggle('on', b.getAttribute('data-metric')===m);});
    var pl=box.querySelector('.pcl'), po=box.querySelector('.pco');
    if(pl) pl.textContent='LTV'+(m==='ltv'?' ↓':''); if(po) po.textContent='임대율'+(m==='occ'?' ↓':'');
  }
  btns.forEach(function(b){b.addEventListener('click', function(){ render(b.getAttribute('data-metric')); });});
})();
// 관심리츠 토글: 홈(SPA)과 같은 localStorage 키(reiton_watch)를 공유해 홈 개인화에 바로 반영.
(function(){
  var TK='${r.ticker}', KEY='reiton_watch';
  function get(){ try{ var v=JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v)?v:[]; }catch(e){ return []; } }
  function set(v){ try{ localStorage.setItem(KEY, JSON.stringify(v)); }catch(e){} }
  var btn=document.getElementById('watchBtn'); if(!btn) return;
  function paint(){ var on=get().indexOf(TK)>=0; btn.classList.toggle('on',on); btn.textContent=on?'★ 관심리츠':'☆ 관심 추가'; btn.setAttribute('aria-pressed', on?'true':'false'); }
  btn.addEventListener('click', function(){ var v=get(), i=v.indexOf(TK); if(i>=0) v.splice(i,1); else v.push(TK); set(v); paint(); });
  paint();
})();
(function(){
  var sb=document.getElementById('shareBtn');
  if(sb) sb.addEventListener('click', function(){
    var d={title:document.title, url:location.href};
    if(navigator.share){ navigator.share(d).catch(function(){}); }
    else if(navigator.clipboard){ navigator.clipboard.writeText(location.href).then(function(){ var t=sb.textContent; sb.textContent='✓ 링크 복사됨'; setTimeout(function(){ sb.textContent=t; },1500); }); }
  });
  var js=document.getElementById('jumpSel');
  if(js) js.addEventListener('change', function(){ if(js.value) location.href='../'+js.value+'/'; });
})();
</script>
</body>
</html>`;
}

// ===== 팩트 시트(별도 페이지 facts.html): 25개 상장리츠 핵심 데이터 한눈에 =====
function _rateGrade(t) {
  const d = DETAIL_BY_TICKER[t] || {};
  const raw = _findVal(d.debt && d.debt.summary, '신용등급') || _findVal(d.overview, '신용등급');
  if (!raw) return null;
  const m = String(raw).match(/(AAA|AA[+-]?|A[+-]?|BBB[+-]?|BB[+-]?|B[+-]?|CCC[+-]?|CC|D)/);
  return m ? m[0] : null;
}
function _fixedPct(t) {
  const d = DETAIL_BY_TICKER[t] || {}; const f = FACTS_BY_TICKER[t] || {};
  return _pct(_findVal(d.debt && d.debt.summary, '고정금리') || (f.debtFixedRatio && f.debtFixedRatio.display));
}
function _waleYears(t) {
  const f = FACTS_BY_TICKER[t] || {}; const d = DETAIL_BY_TICKER[t] || {};
  if (f.wale && typeof f.wale.value === 'number') return f.wale.value;
  const m = String((d.lease && d.lease.wale) || '').match(/(\d+(?:\.\d+)?)\s*년/);
  return m ? parseFloat(m[1]) : null;
}
function _aumEok(t) {
  const a = (FACTS_BY_TICKER[t] || {}).aum;
  if (!a || a.status === 'unavailable') return null;
  const fromDisp = _eok(a.display); // display(예: "5조 624억")가 권위 있는 표기 — 억원으로 환산
  return fromDisp != null ? fromDisp : (typeof a.value === 'number' ? a.value : null);
}
function _dispYield(t) {
  const d = DETAIL_BY_TICKER[t] || {};
  return _pct(d.dividends && d.dividends.yield);
}
function _topTenant(t) {
  const f = FACTS_BY_TICKER[t] || {};
  if (f.topTenant && f.topTenant.value) return String(f.topTenant.value);
  const d = DETAIL_BY_TICKER[t] || {}; const tn = (d.lease && d.lease.tenants) || [];
  return tn.length ? tn.map((x) => x.name).filter(Boolean).slice(0, 2).join(', ') : null;
}
function _factTip(t, key) {
  const p = (FACTS_BY_TICKER[t] || {})[key];
  if (!p || p.status === 'unavailable') return '';
  const bits = [p.asOf ? p.asOf + ' 기준' : null, p.note ? p.note.slice(0, 60) : null].filter(Boolean);
  return bits.length ? ` title="${esc(bits.join(' · '))}"` : '';
}
function _factAsOf(t, key) {
  const p = (FACTS_BY_TICKER[t] || {})[key];
  return p && p.status === 'actual' && p.asOf ? p.asOf : null;
}
// 실배당수익률(TTM)·P/NAV 팩트시트 셀 정보(공용 표시 로직 재사용)
function _ttmInfo(r) {
  const d = dividendDisplay(r, r.price);
  if (!d.show) return { y: null };
  if (!d.isDiv) return { y: 0, nodiv: true, badge: '무배당', tone: 'warn' };
  return { y: d.yield, badge: d.badge, tone: d.tone };
}
function _pnavInfo(r) {
  const n = navDisplay(r.navPerShare, r.price);
  return n ? { pnav: n.pnav, disc: n.discountPct, premium: n.premium } : { pnav: null };
}
function factsRows() {
  return REITS.map((r) => {
    const t = r.ticker; const h = healthOf(t);
    const tt = _ttmInfo(r), pv = _pnavInfo(r);
    return {
      t, name: r.name, primary: r.primary || '기타', sector: (r.sector || []).join('·'),
      health: h.level, reasons: h.reasons || [], risk: RISK_BY_TICKER[t] || null,
      aum: _aumEok(t), freq: r.divMonths.length, annual: (r.ttmDps != null && r.ttmDps > 0) ? r.ttmDps : null,
      yld: _dispYield(t), ltv: numLTV(t), occ: numOcc(t), wale: _waleYears(t),
      fixed: _fixedPct(t), rating: _rateGrade(t), tenant: _topTenant(t),
      ttm: tt.y, ttmBadge: tt.badge || null, ttmTone: tt.tone || null, ttmNodiv: !!tt.nodiv,
      pnav: pv.pnav, pnavDisc: pv.disc != null ? pv.disc : null, pnavPremium: !!pv.premium,
    };
  });
}
const _avg = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const _freqLab = (n) => n >= 12 ? '월' : n >= 4 ? '분기' : n === 2 ? '반기' : n === 1 ? '연1회' : ('연' + n);
const _ltvTone = (v) => v == null ? '' : v >= 65 ? 'bad' : v >= 55 ? 'warn' : 'good';
const _occTone = (v) => v == null ? '' : v >= 95 ? 'good' : v >= 85 ? 'warn' : 'bad';
const _fixTone = (v) => v == null ? '' : v >= 60 ? 'good' : v >= 30 ? 'warn' : 'bad';
const _ratTone = (g) => !g ? '' : /(^|[^A-Z])(D|CCC|CC)([^A-Z]|$)/.test(g) ? 'bad' : /BBB|BB|^B/.test(g) ? 'warn' : /A/.test(g) ? 'good' : '';
const _hRank = { ok: 0, warn: 1, risk: 2 };
const _ratRank = (g) => { const o = ['D', 'CC', 'CCC-', 'CCC', 'CCC+', 'B-', 'B', 'B+', 'BB-', 'BB', 'BB+', 'BBB-', 'BBB', 'BBB+', 'A-', 'A', 'A+', 'AA-', 'AA', 'AA+', 'AAA']; const i = o.indexOf(g); return i < 0 ? '' : i; };

function factsPage() {
  const rows = factsRows();
  const aumVals = rows.map((r) => r.aum).filter((v) => v != null);
  const ltvVals = rows.map((r) => r.ltv).filter((v) => v != null);
  const occVals = rows.map((r) => r.occ).filter((v) => v != null);
  const sumAum = aumVals.reduce((s, v) => s + v, 0);
  const hCount = { ok: 0, warn: 0, risk: 0 }; rows.forEach((r) => hCount[r.health]++);
  const quarterly = rows.filter((r) => r.freq >= 4).length;
  const cov = (k) => rows.filter((r) => r[k] != null).length;

  // 기준일 범위(지표별 상이) — 투명화 배너
  const asOfs = [];
  rows.forEach((r) => ['aum', 'ltv', 'occupancy', 'wale', 'debtFixedRatio'].forEach((k) => { const a = _factAsOf(r.t, k); if (a) asOfs.push(a); }));
  const asOfSorted = asOfs.slice().sort();
  const asOfMin = asOfSorted[0], asOfMax = asOfSorted[asOfSorted.length - 1];

  const num = (v, suf) => v == null ? '<span class="na">—</span>' : esc((Number.isInteger(v) ? v : v.toFixed(1)) + (suf || ''));
  const stat = (label, val, sub) => `<div class="fs-stat"><div class="fs-sv">${val}</div><div class="fs-sl">${esc(label)}</div>${sub ? `<div class="fs-ss">${esc(sub)}</div>` : ''}</div>`;
  const stats = [
    stat('상장리츠', rows.length + '<span class="u">개</span>'),
    stat('합산 자산규모', fmtEok(sumAum).replace('원', '<span class="u">원</span>'), `공시 ${aumVals.length}개 종목 합산`),
    stat('평균 LTV', (_avg(ltvVals) != null ? _avg(ltvVals).toFixed(1) : '—') + '<span class="u">%</span>', `공시 ${ltvVals.length}개 종목`),
    stat('평균 임대율', (_avg(occVals) != null ? _avg(occVals).toFixed(1) : '—') + '<span class="u">%</span>', `공시 ${occVals.length}개 종목`),
    stat('분기배당', quarterly + '<span class="u">개</span>', '연 4회 이상'),
    stat('건강 신호', `<span class="hd ok"></span>${hCount.ok} <span class="hd warn"></span>${hCount.warn} <span class="hd risk"></span>${hCount.risk}`, '안정·주의·위험'),
  ].join('');

  const types = Array.from(new Set(rows.map((r) => r.primary))).sort((a, b) => a.localeCompare(b, 'ko'));
  const typeChips = ['<button class="fchip on" data-type="">전체</button>']
    .concat(types.map((ty) => `<button class="fchip" data-type="${esc(ty)}">${esc(ty)}</button>`)).join('');

  // 컬럼 정의(서버 thead/tbody와 JS가 공유)
  const cols = [
    ['name', '종목', 'txt'], ['type', '유형', 'txt'], ['health', '신호', 'health'], ['aum', '자산규모', 'aum'],
    ['div', '배당', 'div'], ['ttm', '실배당 TTM', 'pct'], ['pnav', 'P/NAV', 'pnav'], ['yld', '공시배당률', 'pct'],
    ['ltv', 'LTV', 'pct'], ['occ', '임대율', 'pct'],
    ['wale', 'WALE', 'yr'], ['fixed', '고정금리', 'pct'], ['rating', '신용등급', 'rating'], ['tenant', '주요 임차인', 'none'],
  ];
  const COV_KEYS = { ttm: 'ttm', pnav: 'pnav', yld: 'yld', ltv: 'ltv', occ: 'occ', wale: 'wale', fixed: 'fixed', rating: 'rating' };
  const sortable = { health: 'num', aum: 'num', div: 'num', pct: 'num', pnav: 'num', yr: 'num', rating: 'num', txt: 'txt' };
  const thead = cols.map(([k, lab, ty]) => {
    const covHtml = COV_KEYS[k] ? `<span class="cov">${cov(k === 'div' ? 'annual' : k)}/${rows.length}</span>` : '';
    if (ty === 'none') return `<th data-col="${k}">${esc(lab)}</th>`;
    const sk = sortable[ty] || 'num';
    return `<th class="sortable" data-col="${k}" data-key="${k}" data-ty="${sk}" tabindex="0" role="button" aria-label="${esc(lab)} 정렬">${esc(lab)}${covHtml}<span class="ar"></span></th>`;
  }).join('');

  const tdNum = (key, val, tone, tip) => `<td class="numc${tone ? ' tn-' + tone : ''}" data-col="${key}"${tip || ''}><span class="cv">${val}</span></td>`;
  const body = rows.map((r) => {
    const hMap = { ok: ['안정', 'ok'], warn: ['주의', 'warn'], risk: ['위험', 'risk'] };
    const [hLab, hCls] = hMap[r.health];
    const divCell = `${esc(_freqLab(r.freq))}${r.annual ? ` · <span class="muted">실적 ${fmt(Math.round(r.annual))}원</span>` : ''}`;
    const hostTip = r.reasons.length ? ` title="${esc(r.reasons.join(' · '))}"` : '';
    const riskBadge = r.risk ? ` <span class="rbadge ${esc(r.risk.level)}" title="${esc(r.risk.note || '')}">${esc(r.risk.label)}</span>` : '';
    // 실배당 TTM 셀: 수익률 + 품질배지(실적일 땐 배지 생략). P/NAV 셀: 배율 + 할인/할증.
    const ttmVal = r.ttm == null ? '<span class="na">—</span>'
      : r.ttmNodiv ? '<span class="fsbadge wn">무배당</span>'
      : `${(r.ttm % 1 ? r.ttm.toFixed(1) : r.ttm)}%${r.ttmBadge && r.ttmBadge !== '실적' ? ` <span class="fsbadge ${r.ttmTone === 'warn' ? 'wn' : 'mut'}" title="${esc(r.ttmBadge)}">${esc(r.ttmBadge)}</span>` : ''}`;
    const pnavVal = r.pnav == null ? '<span class="na">—</span>'
      : `${r.pnav}배 <span class="muted small">${r.pnavPremium ? '할증 ' + Math.abs(r.pnavDisc) : '할인 ' + r.pnavDisc}%</span>`;
    return `<tr data-tk="${r.t}" data-name="${esc(r.name)}" data-type="${esc(r.primary)}" data-health="${_hRank[r.health]}" data-aum="${r.aum ?? ''}" data-freq="${r.freq}" data-div="${r.annual ?? ''}" data-ttm="${r.ttm ?? ''}" data-pnav="${r.pnav ?? ''}" data-yld="${r.yld ?? ''}" data-ltv="${r.ltv ?? ''}" data-occ="${r.occ ?? ''}" data-wale="${r.wale ?? ''}" data-fixed="${r.fixed ?? ''}" data-rating="${_ratRank(r.rating)}" data-tenant="${esc(r.tenant || '')}">
      <td class="namec" data-col="name"><a href="r/${r.t}/"><b>${esc(r.name)}</b><span class="tk">${esc(r.t)}</span></a></td>
      <td data-col="type"><span class="typb">${esc(r.primary)}</span></td>
      <td data-col="health"><span class="hbadge ${hCls}"${hostTip}><span class="hd ${hCls}"></span>${hLab}</span>${riskBadge}</td>
      ${tdNum('aum', r.aum != null ? esc(fmtEok(r.aum)) : '<span class="na">—</span>', '', _factTip(r.t, 'aum'))}
      <td class="divc" data-col="div">${divCell}</td>
      <td class="numc" data-col="ttm"><span class="cv">${ttmVal}</span></td>
      <td class="numc" data-col="pnav"><span class="cv">${pnavVal}</span></td>
      ${tdNum('yld', num(r.yld, '%'), '')}
      ${tdNum('ltv', num(r.ltv, '%'), _ltvTone(r.ltv), _factTip(r.t, 'ltv'))}
      ${tdNum('occ', num(r.occ, '%'), _occTone(r.occ), _factTip(r.t, 'occupancy'))}
      ${tdNum('wale', num(r.wale, '년'), '', _factTip(r.t, 'wale'))}
      ${tdNum('fixed', num(r.fixed, '%'), _fixTone(r.fixed), _factTip(r.t, 'debtFixedRatio'))}
      ${tdNum('rating', r.rating ? esc(r.rating) : '<span class="na">—</span>', _ratTone(r.rating))}
      <td class="tenc" data-col="tenant">${r.tenant ? esc(r.tenant) : '<span class="na">—</span>'}</td>
    </tr>`;
  }).join('\n');

  const TIP = {
    LTV: '담보인정비율 = 총차입금 ÷ 자산(또는 감정가). 높을수록 레버리지·금리 민감도 ↑',
    임대율: '임대된 면적 비율(=100%−공실률). 높을수록 안정',
    WALE: '가중평균 잔여임대차기간(년). 길수록 임대수익 안정',
    고정금리: '총차입 중 고정금리 비중. 높을수록 금리 인상 방어력 ↑',
    배당수익률: '주가 대비 배당 비율. 기본은 공시값, 시세 연동 시 “실시간” 배지로 표시',
  };
  const legend = Object.entries(TIP).map(([k, v]) => `<span class="lgi"><b>${esc(k)}</b> ${esc(v)}</span>`).join('');

  // JS에 넘길 정제 데이터
  const DATA = rows.map((r) => ({
    t: r.t, name: r.name, type: r.primary, sector: r.sector, health: r.health, reasons: r.reasons,
    risk: r.risk ? { level: r.risk.level, label: r.risk.label } : null,
    aum: r.aum, freq: r.freq, annual: r.annual, ttm: r.ttm, pnav: r.pnav, yld: r.yld, ltv: r.ltv, occ: r.occ, wale: r.wale,
    fixed: r.fixed, rating: r.rating, ratingRank: _ratRank(r.rating) === '' ? null : _ratRank(r.rating), tenant: r.tenant,
  }));
  const dataJson = JSON.stringify(DATA).replace(/</g, '\\u003c');

  const ld = {
    '@context': 'https://schema.org', '@type': 'Dataset', name: '상장리츠 핵심 팩트 데이터',
    description: '국내 상장리츠 25개의 LTV·임대율·WALE·고정금리비중·신용등급·자산규모 등 핵심 지표 정리(교육용).',
    url: BASE + '/facts.html', inLanguage: 'ko', isPartOf: { '@type': 'WebSite', name: '리츠온 REITs ON', url: BASE + '/' },
  };

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>리츠 팩트시트 — 상장리츠 25개 핵심 데이터 한눈에 | 리츠온 REITs ON</title>
<meta name="description" content="국내 상장리츠 25개의 LTV·임대율·WALE·고정금리비중·신용등급·자산규모를 한 표로 정렬·비교·분포·내보내기. 출처·기준일 포함. (교육용, 투자 권유 아님)" />
<link rel="canonical" href="${BASE}/facts.html" />
<link rel="icon" href="favicon.svg" type="image/svg+xml" />
<meta name="theme-color" content="#3254ff" />
<meta property="og:type" content="website" />
<meta property="og:title" content="리츠 팩트시트 — 상장리츠 25개 핵심 데이터" />
<meta property="og:description" content="LTV·임대율·WALE·고정금리비중·신용등급을 한 표로 정렬·비교·분포 시각화(교육용)." />
<meta property="og:url" content="${BASE}/facts.html" />
<meta property="og:image" content="${BASE}/og.png" />
<meta name="twitter:card" content="summary_large_image" />
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<style>
:root{--brand:#3254ff;--bg:#f5f7fb;--surface:#fff;--text:#172033;--muted:#5a647b;--line:#e5e9f2;--soft:#eef1f7;--tint:#edf1ff;--good:#0c9b69;--goodb:#e4f5ec;--warn:#b7791f;--warnb:#fbf0d8;--bad:#c4392f;--badb:#fbe4e1}
:root[data-theme="dark"]{--bg:#0f1626;--surface:#161f33;--text:#e8edf7;--muted:#9aa6bf;--line:#283450;--soft:#1d2740;--tint:#1b2740;--good:#3ddc97;--goodb:#103226;--warn:#e0b765;--warnb:#322611;--bad:#f08a80;--badb:#341a17}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0f1626;--surface:#161f33;--text:#e8edf7;--muted:#9aa6bf;--line:#283450;--soft:#1d2740;--tint:#1b2740;--good:#3ddc97;--goodb:#103226;--warn:#e0b765;--warnb:#322611;--bad:#f08a80;--badb:#341a17}}
*{box-sizing:border-box}body{margin:0;font-family:'Pretendard','Apple SD Gothic Neo','Malgun Gothic',system-ui,sans-serif;background:var(--bg);color:var(--text);line-height:1.55;-webkit-text-size-adjust:100%}
a{color:inherit}
.wrap{max-width:1240px;margin:0 auto;padding:18px 16px 90px}
.top{display:flex;align-items:center;gap:12px;padding:12px 0;flex-wrap:wrap}
.logo{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#3254ff,#00a78e);color:#fff;font-weight:900;display:grid;place-items:center;text-decoration:none}
.brand{color:var(--text);text-decoration:none;font-weight:800}
.top nav{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.top nav a{font-size:13px;font-weight:700;color:var(--muted);text-decoration:none;padding:6px 12px;border-radius:999px;border:1px solid var(--line);background:var(--surface)}
.top nav a.cur{color:#fff;background:var(--brand);border-color:var(--brand)}
.dk{font-size:15px;cursor:pointer;background:var(--surface);border:1px solid var(--line);border-radius:999px;width:34px;height:34px;line-height:1}
.eyebrow{display:inline-block;font-size:12px;font-weight:800;color:var(--brand);background:var(--tint);border-radius:999px;padding:5px 12px}
h1{font-size:26px;letter-spacing:-.6px;margin:14px 0 6px}
.lead{color:var(--muted);margin:0 0 12px;font-size:14.5px;max-width:820px}
.fresh{font-size:12px;color:var(--muted);background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:8px 12px;margin:0 0 14px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.fresh b{color:var(--text)}
.fs-stats{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin:14px 0 16px}
.fs-stat{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:12px 14px}
.fs-sv{font-size:22px;font-weight:900;letter-spacing:-.5px}.fs-sv .u{font-size:13px;font-weight:700;color:var(--muted);margin-left:1px}
.fs-sl{font-size:12.5px;font-weight:700;margin-top:2px}.fs-ss{font-size:11px;color:var(--muted);margin-top:1px}
.hd{display:inline-block;width:9px;height:9px;border-radius:50%;vertical-align:middle;margin:0 2px 0 6px}
.hd:first-child{margin-left:0}.hd.ok{background:var(--good)}.hd.warn{background:#e0a33b}.hd.risk{background:#e0544b}
.toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
.toolbar input{flex:1;min-width:190px;padding:10px 14px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--text);font-size:14px}
.tbtn{padding:8px 13px;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:var(--muted);font-size:12.5px;font-weight:700;cursor:pointer;white-space:nowrap}
.tbtn.on{color:#fff;background:var(--brand);border-color:var(--brand)}
.tbtn:hover{border-color:var(--brand)}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.seg button{padding:8px 12px;border:0;background:var(--surface);color:var(--muted);font-size:12.5px;font-weight:700;cursor:pointer}
.seg button.on{background:var(--brand);color:#fff}
.fchips,.hchips,.pchips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.pchips .pchip{padding:6px 11px;border-radius:999px;border:1px dashed var(--line);background:var(--surface);color:var(--muted);font-size:12px;font-weight:700;cursor:pointer}
.pchips .pchip.on{color:#fff;background:var(--good);border-color:var(--good);border-style:solid}
.fchip,.hchip{padding:6px 12px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--muted);font-size:12.5px;font-weight:700;cursor:pointer}
.fchip.on,.hchip.on{color:#fff;background:var(--brand);border-color:var(--brand)}
.hchip .hd{margin:0 5px 0 0}
.count{font-size:12.5px;color:var(--muted);font-weight:700;margin:2px 0 8px}.count b{color:var(--text)}
.colmenu{position:relative;display:inline-block}
.colpop{position:absolute;right:0;top:38px;z-index:20;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:10px 12px;box-shadow:0 12px 30px rgba(0,0,0,.16);min-width:170px}
.colpop label{display:flex;align-items:center;gap:7px;font-size:13px;padding:4px 0;cursor:pointer}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:14px 16px;margin-bottom:14px}
.panel h3{margin:0 0 4px;font-size:15px}.panel .pcap{font-size:12px;color:var(--muted);margin:0 0 10px}
.tbl-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:16px;background:var(--surface);-webkit-overflow-scrolling:touch}
table{border-collapse:collapse;width:100%;min-width:1040px;font-size:13.5px}
thead th{position:sticky;top:0;background:var(--soft);z-index:2;text-align:right;padding:10px 12px;font-size:12px;font-weight:800;color:var(--muted);white-space:nowrap;border-bottom:1px solid var(--line)}
thead th[data-col="name"],thead th[data-col="type"],thead th[data-col="health"],thead th[data-col="tenant"]{text-align:left}
th.sortable{cursor:pointer;user-select:none}th.sortable:hover{color:var(--text)}
th .cov{display:block;font-size:9.5px;font-weight:700;color:var(--muted);opacity:.7;margin-top:1px}
th .ar{display:inline-block;width:0;height:0;margin-left:4px;vertical-align:middle;opacity:.4}
th.asc .ar{border-left:4px solid transparent;border-right:4px solid transparent;border-bottom:5px solid currentColor;opacity:1}
th.desc .ar{border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid currentColor;opacity:1}
tbody td{padding:9px 12px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap;position:relative}
tbody tr:last-child td{border-bottom:0}
tbody tr:hover{background:var(--tint)}
tbody tr.pinned{background:var(--tint)}
.namec{text-align:left;position:sticky;left:0;background:var(--surface);z-index:1;display:flex;align-items:center;gap:8px}
tbody tr:hover .namec,tbody tr.pinned .namec{background:var(--tint)}
.namec a{text-decoration:none;display:flex;flex-direction:column;line-height:1.25}
.namec b{font-weight:800}.namec .tk{font-size:11px;color:var(--muted);font-weight:600}
.nc-tools{display:flex;flex-direction:column;gap:3px;align-items:center}
.pin{width:18px;height:18px;border:0;background:none;cursor:pointer;font-size:13px;line-height:1;color:var(--muted);opacity:.5;padding:0}
.pin.on{opacity:1;color:#e0a33b}
.csel{display:flex}.csel input{cursor:pointer}
.typb{display:inline-block;font-size:11.5px;font-weight:700;color:var(--muted);background:var(--soft);border-radius:999px;padding:3px 9px}
td[data-col="type"],td.divc,.tenc{text-align:left}
.divc{font-size:12.5px;font-weight:700}.divc .muted{font-weight:600}
.tenc{max-width:240px;overflow:hidden;text-overflow:ellipsis;font-size:12.5px;color:var(--muted)}
.numc{font-variant-numeric:tabular-nums;font-weight:700}
.numc .cbar{position:absolute;left:0;bottom:0;height:3px;background:var(--brand);opacity:.5;border-radius:0 2px 2px 0}
.lvb{font-size:9.5px;font-weight:800;color:var(--good);background:var(--goodb);border-radius:4px;padding:1px 4px;margin-left:3px;vertical-align:middle}
.na{color:var(--muted);opacity:.55;font-weight:600}
.muted{color:var(--muted)}
.tn-good{color:var(--good)}.tn-warn{color:var(--warn)}.tn-bad{color:var(--bad)}
.hbadge{display:inline-flex;align-items:center;font-size:11.5px;font-weight:800;padding:3px 9px 3px 7px;border-radius:999px}
.hbadge.ok{background:var(--goodb);color:var(--good)}.hbadge.warn{background:var(--warnb);color:var(--warn)}.hbadge.risk{background:var(--badb);color:var(--bad)}
.rbadge{display:inline-block;font-size:10px;font-weight:800;padding:2px 6px;border-radius:6px;margin-left:2px}
.rbadge.high{background:var(--badb);color:var(--bad)}.rbadge.caution{background:var(--warnb);color:var(--warn)}
.fsbadge{display:inline-block;font-size:9.5px;font-weight:800;padding:1px 5px;border-radius:5px;margin-left:3px;vertical-align:middle;background:var(--soft);color:var(--muted);border:1px solid var(--line)}
.fsbadge.wn{background:var(--warnb);color:var(--warn);border-color:var(--warnb)}
.fsbadge.mut{background:var(--soft);color:var(--muted)}
tfoot td{padding:9px 12px;border-top:2px solid var(--line);font-size:12px;font-weight:800;text-align:right;color:var(--muted);background:var(--soft)}
tfoot td.ft-lab{text-align:left}tfoot td.ft-lab span{font-weight:600;opacity:.8}
.empty{padding:30px;text-align:center;color:var(--muted)}
.fcards{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.fcard{display:block;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:13px 15px;text-decoration:none}
.fcard:hover{border-color:var(--brand)}
.fc-h{display:flex;align-items:center;justify-content:space-between}.fc-h b{font-weight:800;font-size:15px}
.fc-t{font-size:12px;color:var(--muted);margin:1px 0 9px}
.fc-g{display:grid;grid-template-columns:1fr 1fr;gap:5px 12px}
.kv{display:flex;justify-content:space-between;font-size:12.5px}.kv i{color:var(--muted);font-style:normal}.kv b{font-weight:700}
.sectbl{width:100%;min-width:0;font-size:13px}.sectbl th,.sectbl td{padding:7px 10px;border-bottom:1px solid var(--line);text-align:right}.sectbl th:first-child,.sectbl td:first-child{text-align:left}
.scsvg{width:100%;height:auto;display:block}
.scaxes{display:flex;gap:14px;flex-wrap:wrap;margin:0 0 8px}
.scaxes label{font-size:12px;font-weight:700;color:var(--muted);display:flex;align-items:center;gap:6px}
.scsel{font-size:12.5px;font-weight:700;padding:5px 8px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--text)}
.legend{margin:16px 0 0;display:grid;gap:5px}
.lgi{font-size:12px;color:var(--muted)}.lgi b{color:var(--text);font-weight:800;margin-right:4px}
.note{margin-top:14px;font-size:12px;color:var(--muted);line-height:1.6;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.foot{margin-top:20px;font-size:12px;color:var(--muted)}.foot a{color:var(--brand);text-decoration:none;font-weight:700}
.cmpbar{position:fixed;left:50%;transform:translateX(-50%);bottom:16px;z-index:40;background:var(--text);color:var(--bg);border-radius:999px;padding:10px 12px 10px 18px;display:none;align-items:center;gap:12px;box-shadow:0 10px 30px rgba(0,0,0,.25);font-size:13px;font-weight:700}
.cmpbar.show{display:flex}
.cmpbar button{border:0;border-radius:999px;padding:7px 13px;font-weight:800;cursor:pointer;font-size:12.5px}
.cmpbar .go{background:var(--brand);color:#fff}.cmpbar .clr{background:transparent;color:var(--bg);opacity:.8}
.modal{position:fixed;inset:0;z-index:60;background:rgba(10,15,25,.55);display:none;align-items:center;justify-content:center;padding:16px}
.modal.show{display:flex}
.modal-in{background:var(--surface);border-radius:18px;max-width:760px;width:100%;max-height:86vh;overflow:auto;padding:18px}
.modal-in h3{margin:0 0 12px;font-size:17px}
.cmptbl{width:100%;border-collapse:collapse;font-size:13px;min-width:0}
.cmptbl th,.cmptbl td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:right}.cmptbl th:first-child,.cmptbl td:first-child{text-align:left;color:var(--muted);font-weight:700}
.cmptbl thead th{text-align:right;font-weight:800}
.mclose{float:right;border:1px solid var(--line);background:var(--surface);border-radius:8px;padding:5px 11px;cursor:pointer;font-weight:800}
@media (max-width:760px){.fs-stats{grid-template-columns:repeat(2,1fr)}h1{font-size:22px}.wrap{padding:14px 12px 90px}}
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <a class="logo" href="./">R</a><a class="brand" href="./">리츠온 REITs ON</a>
    <nav><a href="./">홈</a><a href="facts.html" class="cur">팩트시트</a><button class="dk" id="dk" aria-label="다크 모드 전환" title="다크 모드">🌙</button></nav>
  </div>
  <span class="eyebrow">데이터 · 교육용 · 투자 권유 아님</span>
  <h1>리츠 팩트시트 — 핵심 데이터 한눈에</h1>
  <p class="lead">국내 상장리츠 ${rows.length}개의 자산규모·LTV·임대율·WALE·고정금리비중·신용등급을 한 표에 모았습니다. 헤더로 정렬, 프리셋·유형·건강신호·검색으로 좁히고, 분포·유형집계·CSV로 깊게 보세요. 모든 수치는 투자보고서·DART·KAREIT 공시 기반이며, 미확보 항목은 “—”로 둡니다.</p>
  <div class="fresh">📅 기준일 <b>${esc(asOfMin || '—')} ~ ${esc(asOfMax || '—')}</b> · 지표마다 공시 기준일이 다릅니다(셀에 마우스를 올리면 기준일·출처 표시). · 배당수익률은 기본 공시값이며 시세 연동 시 <b>실시간</b> 배지로 구분합니다.</div>
  <div class="fs-stats">${stats}</div>

  <div class="toolbar">
    <input id="q" type="search" placeholder="종목·임차인·유형 검색 (예: SK, 오피스, 삼성)" aria-label="검색" />
    <div class="seg" id="viewseg"><button data-view="table" class="on">표</button><button data-view="card">카드</button></div>
    <button class="tbtn" id="bScatter">📈 분포</button>
    <button class="tbtn" id="bSector">Σ 유형집계</button>
    <button class="tbtn" id="bHeat">🎨 히트맵</button>
    <button class="tbtn" id="bBars">▏막대</button>
    <div class="colmenu"><button class="tbtn" id="bCols">⚙ 열</button><div class="colpop" id="colpop" hidden></div></div>
    <button class="tbtn" id="bCsv">⬇ CSV</button>
  </div>
  <div class="pchips" id="pchips" aria-label="스마트 프리셋"></div>
  <div class="fchips" id="fchips">${typeChips}</div>
  <div class="hchips" id="hchips">
    <button class="hchip on" data-h="">전체</button>
    <button class="hchip" data-h="ok"><span class="hd ok"></span>안정</button>
    <button class="hchip" data-h="warn"><span class="hd warn"></span>주의</button>
    <button class="hchip" data-h="risk"><span class="hd risk"></span>위험</button>
  </div>
  <div class="count" id="count"></div>

  <div class="panel" id="scatter" hidden>
    <h3>분포 <span class="muted" style="font-size:12px;font-weight:600">(버블=크기축, 색=건강신호 · 점선=중앙값)</span></h3>
    <div class="scaxes">
      <label>가로축 <select id="scx" class="scsel"></select></label>
      <label>세로축 <select id="scy" class="scsel"></select></label>
      <label>버블 크기 <select id="scsz" class="scsel"></select></label>
    </div>
    <p class="pcap">두 지표의 관계를 탐색합니다. 지표마다 공시 기준일이 달라 단순 비교는 주의가 필요합니다. 점을 누르면 종목 페이지로 이동합니다.</p>
    <div id="scbox"></div>
  </div>
  <div class="panel" id="sector" hidden>
    <h3>유형별 집계</h3>
    <p class="pcap">현재 필터 기준 · 평균은 공시 종목만 반영(미확보 제외).</p>
    <div id="secbox"></div>
  </div>

  <div class="tbl-wrap" id="tblwrap">
    <table id="ft">
      <thead><tr>${thead}</tr></thead>
      <tbody id="ftb">${body}</tbody>
    </table>
    <div class="empty" id="empty" hidden>조건에 맞는 리츠가 없습니다.</div>
  </div>
  <div class="fcards" id="fcards" hidden></div>

  <div class="legend">${legend}</div>
  <div class="note">⚠ 본 표는 일반 투자자 교육·정보 제공용이며 <b>특정 종목의 매수·매도 추천이 아닙니다.</b> ‘건강 신호’는 LTV·고정금리·손익 등 공시수치 기반의 규칙 요약일 뿐 투자 안전성·수익성과 무관하며, 의도적으로 종합 점수·순위를 만들지 않습니다. LTV·임대율 등은 종목별 기준일·산정방식이 다를 수 있으니 셀의 기준일·출처를 확인하고, 투자 전 DART·투자보고서 원문과 최신 시세를 반드시 확인하세요.</div>
  <div class="foot">데이터 원천: 각 리츠 투자보고서 · DART · 한국리츠협회(KAREIT) · 단일 파일 <code>data/reits.json</code>(출처·기준일 포함) · <a href="about/">산정 방법론</a> · <a href="./">← 리츠온 홈으로</a></div>
</div>

<div class="cmpbar" id="cmpbar"><span id="cmptext"></span><button class="go" id="cmpgo">비교 보기</button><button class="clr" id="cmpclr">해제</button></div>
<div class="modal" id="modal"><div class="modal-in"><button class="mclose" id="mclose">닫기</button><h3>리츠 비교</h3><div id="cmpbody"></div></div></div>

<script>
var FACTS=${dataJson};
(function(){
  var API='https://reits-on-api.modelter.workers.dev';
  var byTk={};FACTS.forEach(function(r){byTk[r.t]=r;});
  var NUM=['aum','ttm','pnav','yld','ltv','occ','wale','fixed'];
  var COLS=[['name','종목'],['type','유형'],['health','신호'],['aum','자산규모'],['div','배당'],['ttm','실배당 TTM'],['pnav','P/NAV'],['yld','공시배당률'],['ltv','LTV'],['occ','임대율'],['wale','WALE'],['fixed','고정금리'],['rating','신용등급'],['tenant','주요 임차인']];
  var ranges={};NUM.forEach(function(k){var vs=FACTS.map(function(r){return r[k];}).filter(function(v){return v!=null;});ranges[k]=vs.length?{min:Math.min.apply(null,vs),max:Math.max.apply(null,vs)}:{min:0,max:1};});
  var PRESETS=[
    {k:'big',l:'자산 1조+',f:function(r){return r.aum!=null&&r.aum>=10000;}},
    {k:'lowltv',l:'저LTV ≤50%',f:function(r){return r.ltv!=null&&r.ltv<=50;}},
    {k:'highocc',l:'고임대율 ≥95%',f:function(r){return r.occ!=null&&r.occ>=95;}},
    {k:'longwale',l:'WALE ≥7년',f:function(r){return r.wale!=null&&r.wale>=7;}},
    {k:'highfix',l:'고정금리 ≥60%',f:function(r){return r.fixed!=null&&r.fixed>=60;}},
    {k:'agrade',l:'신용 A이상',f:function(r){return r.ratingRank!=null&&r.ratingRank>=14;}},
    {k:'quarter',l:'분기배당',f:function(r){return r.freq>=4;}}
  ];
  var tb=document.getElementById('ftb'),tbl=document.getElementById('ft'),empty=document.getElementById('empty');
  var trByTk={};[].slice.call(tb.querySelectorAll('tr')).forEach(function(tr){trByTk[tr.dataset.tk]=tr;});
  var PIN='facts_pin_v1';
  function loadPins(){try{return JSON.parse(localStorage.getItem(PIN)||'{}')||{};}catch(e){return {};}}
  var state={q:'',types:{},h:'',presets:{},key:'aum',dir:-1,view:'table',heat:false,bars:false,hide:{},pins:loadPins(),sel:{},live:false,scx:'ltv',scy:'yld',scsz:'aum'};

  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function avg(a){return a.length?a.reduce(function(s,x){return s+x;},0)/a.length:null;}
  function median(a){a=a.slice().sort(function(x,y){return x-y;});var n=a.length;if(!n)return null;return n%2?a[(n-1)/2]:(a[n/2-1]+a[n/2])/2;}
  function fp(v){return v==null?'—':((v%1)?v.toFixed(1):v)+'%';}
  function fy(v){return v==null?'—':((v%1)?v.toFixed(1):v)+'년';}
  function fa(v){if(v==null)return '—';return v>=10000?(((v/10000)%1)?(v/10000).toFixed(1):(v/10000))+'조원':Math.round(v).toLocaleString('ko-KR')+'억원';}
  function ff(n){return n>=12?'월':n>=4?'분기':n===2?'반기':n===1?'연1회':'연'+n;}
  function yOf(r){return (state.live&&r.yldLive!=null)?r.yldLive:r.yld;}
  function fpn(v){return v==null?'—':v+'배';}
  var METRICS={
    ltv:{l:'LTV (%)',g:function(r){return r.ltv;},f:fp},
    ttm:{l:'실배당 TTM (%)',g:function(r){return r.ttm;},f:fp},
    pnav:{l:'P/NAV (배)',g:function(r){return r.pnav;},f:fpn},
    yld:{l:'공시배당률 (%)',g:function(r){return yOf(r);},f:fp},
    occ:{l:'임대율 (%)',g:function(r){return r.occ;},f:fp},
    wale:{l:'WALE (년)',g:function(r){return r.wale;},f:fy},
    fixed:{l:'고정금리 (%)',g:function(r){return r.fixed;},f:fp},
    aum:{l:'자산규모',g:function(r){return r.aum;},f:fa},
    annual:{l:'연배당(추정)',g:function(r){return r.annual;},f:function(v){return v==null?'—':Math.round(v).toLocaleString('ko-KR')+'원';}}
  };
  var AXOPT=['ttm','pnav','ltv','yld','occ','wale','fixed','aum','annual'],SZOPT=['aum','annual'];
  function tval(mk,v){return mk==='aum'?(v/10000).toFixed(1)+'조':mk==='annual'?Math.round(v):((v%1)?v.toFixed(1):v);}

  function passes(r){
    var q=state.q.toLowerCase();
    if(q&&(r.name||'').toLowerCase().indexOf(q)<0&&(r.tenant||'').toLowerCase().indexOf(q)<0&&(r.type||'').toLowerCase().indexOf(q)<0)return false;
    var tks=Object.keys(state.types);if(tks.length&&!state.types[r.type])return false;
    if(state.h&&r.health!==state.h)return false;
    var pk=Object.keys(state.presets).filter(function(k){return state.presets[k];});
    for(var i=0;i<pk.length;i++){var p=null;for(var j=0;j<PRESETS.length;j++)if(PRESETS[j].k===pk[i])p=PRESETS[j];if(p&&!p.f(r))return false;}
    return true;
  }
  function sortVal(r,k){
    if(k==='health')return ({ok:0,warn:1,risk:2})[r.health];
    if(k==='div')return r.annual;
    if(k==='rating')return r.ratingRank;
    if(k==='yld')return yOf(r);
    return r[k];
  }
  function cmp(a,b){
    var pa=state.pins[a.t]?1:0,pb=state.pins[b.t]?1:0;if(pa!==pb)return pb-pa;
    if(state.key==='name')return state.dir*a.name.localeCompare(b.name,'ko');
    if(state.key==='type')return state.dir*a.type.localeCompare(b.type,'ko');
    var av=sortVal(a,state.key),bv=sortVal(b,state.key);
    var ae=av==null,be=bv==null;if(ae&&be)return 0;if(ae)return 1;if(be)return -1;
    return state.dir*(av-bv);
  }
  function decor(){
    [].slice.call(tb.querySelectorAll('tr')).forEach(function(tr){
      NUM.forEach(function(k){
        var td=tr.querySelector('td[data-col="'+k+'"]');if(!td)return;
        var raw=tr.dataset[k];var v=(raw===''||raw==null)?null:parseFloat(raw);
        var old=td.querySelector('.cbar');if(old)old.parentNode.removeChild(old);
        td.style.background='';
        if(v==null)return;
        var rg=ranges[k],frac=(rg.max>rg.min)?(v-rg.min)/(rg.max-rg.min):0.5;
        if(state.bars){var i=document.createElement('i');i.className='cbar';i.style.width=Math.max(3,frac*100)+'%';td.appendChild(i);}
        if(state.heat){var good=(k==='ltv')?(1-frac):frac;var hue=Math.round(good*135);td.style.background='hsla('+hue+',62%,48%,0.17)';}
      });
    });
  }
  function footer(vis){
    var tf=tbl.querySelector('tfoot');if(!tf){tf=document.createElement('tfoot');tbl.appendChild(tf);}
    var cells=COLS.map(function(c){
      var k=c[0];
      if(k==='name')return '<td class="ft-lab" data-col="name">중앙값 <span>(범위)</span></td>';
      if(NUM.indexOf(k)<0)return '<td data-col="'+k+'"></td>';
      var vs=vis.map(function(r){return k==='yld'?yOf(r):r[k];}).filter(function(v){return v!=null;});
      if(!vs.length)return '<td class="numc na" data-col="'+k+'">—</td>';
      var f=k==='aum'?fa:k==='wale'?fy:fp;var md=median(vs),mn=Math.min.apply(null,vs),mx=Math.max.apply(null,vs);
      return '<td class="numc" data-col="'+k+'" title="중앙값 '+f(md)+' · 평균 '+f(avg(vs))+' · 범위 '+f(mn)+'–'+f(mx)+'">'+f(md)+'</td>';
    }).join('');
    tf.innerHTML='<tr>'+cells+'</tr>';
  }
  function applyHide(){
    COLS.forEach(function(c){
      var k=c[0],on=!state.hide[k];
      [].slice.call(tbl.querySelectorAll('[data-col="'+k+'"]')).forEach(function(el){el.style.display=on?'':'none';});
    });
  }
  function kv(k,v){return '<span class="kv"><i>'+esc(k)+'</i><b>'+esc(v)+'</b></span>';}
  function cards(vis){
    var box=document.getElementById('fcards');
    box.innerHTML=vis.map(function(r){
      return '<a class="fcard" href="r/'+r.t+'/"><div class="fc-h"><b>'+esc(r.name)+'</b><span class="hd '+r.health+'"></span></div><div class="fc-t">'+esc(r.type)+' · '+esc(r.t)+(r.risk?' · ⚠'+esc(r.risk.label):'')+'</div><div class="fc-g">'
        +kv('자산',fa(r.aum))+kv('배당',ff(r.freq))+kv('LTV',fp(r.ltv))+kv('임대율',fp(r.occ))+kv('WALE',fy(r.wale))+kv('고정금리',fp(r.fixed))+kv('신용',r.rating||'—')+kv('수익률',fp(yOf(r)))
        +'</div></a>';
    }).join('');
  }
  function sector(vis){
    var box=document.getElementById('secbox');var g={};vis.forEach(function(r){(g[r.type]=g[r.type]||[]).push(r);});
    var keys=Object.keys(g).sort(function(a,b){return a.localeCompare(b,'ko');});
    var bodyH=keys.map(function(ty){var a=g[ty];
      function av(k){var v=a.map(function(r){return k==='yld'?yOf(r):r[k];}).filter(function(x){return x!=null;});return v.length?avg(v):null;}
      var sa=a.map(function(r){return r.aum;}).filter(function(x){return x!=null;}).reduce(function(s,x){return s+x;},0);
      return '<tr><td>'+esc(ty)+'</td><td>'+a.length+'</td><td>'+fa(sa)+'</td><td>'+fp(av('ltv'))+'</td><td>'+fp(av('occ'))+'</td><td>'+fp(av('yld'))+'</td></tr>';
    }).join('');
    box.innerHTML='<table class="sectbl"><thead><tr><th>유형</th><th>종목</th><th>합산자산</th><th>평균LTV</th><th>평균임대율</th><th>평균수익률</th></tr></thead><tbody>'+bodyH+'</tbody></table>';
  }
  function scatter(vis){
    var box=document.getElementById('scbox');
    var xm=METRICS[state.scx]||METRICS.ltv,ym=METRICS[state.scy]||METRICS.yld,sm=METRICS[state.scsz]||METRICS.aum;
    var pts=vis.filter(function(r){return xm.g(r)!=null&&ym.g(r)!=null;});
    if(pts.length<2){box.innerHTML='<p class="muted" style="padding:12px">선택한 두 지표가 모두 공시된 종목이 부족해 분포를 표시할 수 없습니다. 다른 축을 선택해 보세요.</p>';return;}
    var W=640,H=380,pad=54;
    var xs=pts.map(function(p){return xm.g(p);}),ys=pts.map(function(p){return ym.g(p);});
    var xmin=Math.min.apply(null,xs),xmax=Math.max.apply(null,xs),ymin=Math.min.apply(null,ys),ymax=Math.max.apply(null,ys);
    var xp=(xmax-xmin)*0.08||1,yp=(ymax-ymin)*0.08||1;xmin=Math.max(0,xmin-xp);xmax+=xp;ymin=Math.max(0,ymin-yp);ymax+=yp;
    if(xmax<=xmin)xmax=xmin+1;if(ymax<=ymin)ymax=ymin+1;
    function X(v){return pad+(v-xmin)/(xmax-xmin)*(W-pad-16);}
    function Y(v){return H-pad-(v-ymin)/(ymax-ymin)*(H-pad-16);}
    var svals=pts.map(function(p){return sm.g(p)||0;}),smax=Math.max.apply(null,svals)||1;
    function R(a){return 6+Math.sqrt((a||0)/smax)*22;}
    var col={ok:'#0c9b69',warn:'#e0a33b',risk:'#e0544b'};
    var mx=median(xs),my=median(ys);
    var s='<svg class="scsvg" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="xMidYMid meet" role="img" aria-label="'+esc(xm.l)+' 대 '+esc(ym.l)+' 분포">';
    s+='<line x1="'+pad+'" y1="'+(H-pad)+'" x2="'+(W-8)+'" y2="'+(H-pad)+'" stroke="currentColor" opacity="0.25"/>';
    s+='<line x1="'+pad+'" y1="12" x2="'+pad+'" y2="'+(H-pad)+'" stroke="currentColor" opacity="0.25"/>';
    s+='<line x1="'+X(mx)+'" y1="12" x2="'+X(mx)+'" y2="'+(H-pad)+'" stroke="currentColor" opacity="0.12" stroke-dasharray="4 4"/>';
    s+='<line x1="'+pad+'" y1="'+Y(my)+'" x2="'+(W-8)+'" y2="'+Y(my)+'" stroke="currentColor" opacity="0.12" stroke-dasharray="4 4"/>';
    var i;for(i=0;i<=4;i++){var xv=xmin+(xmax-xmin)*i/4;s+='<text x="'+X(xv)+'" y="'+(H-pad+16)+'" font-size="10" fill="currentColor" opacity="0.6" text-anchor="middle">'+tval(state.scx,xv)+'</text>';}
    for(i=0;i<=4;i++){var yv=ymin+(ymax-ymin)*i/4;s+='<text x="'+(pad-8)+'" y="'+(Y(yv)+3)+'" font-size="10" fill="currentColor" opacity="0.6" text-anchor="end">'+tval(state.scy,yv)+'</text>';}
    s+='<text x="'+((W+pad)/2)+'" y="'+(H-8)+'" font-size="11" fill="currentColor" opacity="0.7" text-anchor="middle">'+esc(xm.l)+'</text>';
    s+='<text x="14" y="14" font-size="11" fill="currentColor" opacity="0.7">'+esc(ym.l)+'</text>';
    pts.sort(function(a,b){return (sm.g(b)||0)-(sm.g(a)||0);}).forEach(function(p){
      var cx=X(xm.g(p)),cy=Y(ym.g(p)),r=R(sm.g(p));
      s+='<a href="r/'+p.t+'/"><circle cx="'+cx.toFixed(1)+'" cy="'+cy.toFixed(1)+'" r="'+r.toFixed(1)+'" fill="'+col[p.health]+'" fill-opacity="0.55" stroke="'+col[p.health]+'" stroke-width="1.5"><title>'+esc(p.name)+' · '+esc(xm.l)+' '+xm.f(xm.g(p))+' · '+esc(ym.l)+' '+ym.f(ym.g(p))+' · '+esc(sm.l)+' '+sm.f(sm.g(p))+'</title></circle>';
      if(r>=14)s+='<text x="'+cx.toFixed(1)+'" y="'+(cy+3).toFixed(1)+'" font-size="9" fill="currentColor" text-anchor="middle" pointer-events="none">'+esc(p.name.slice(0,4))+'</text>';
      s+='</a>';
    });
    s+='</svg>';
    box.innerHTML=s;
  }
  function cmpbar(){
    var ks=Object.keys(state.sel);var bar=document.getElementById('cmpbar');
    document.getElementById('cmptext').textContent=ks.length+'개 선택';
    bar.className='cmpbar'+(ks.length>=2?' show':(ks.length===1?' show':''));
    document.getElementById('cmpgo').disabled=ks.length<2;
  }
  function openCmp(){
    var ks=Object.keys(state.sel).slice(0,4);if(ks.length<2)return;
    var rs=ks.map(function(t){return byTk[t];});
    var metrics=[['자산규모',function(r){return fa(r.aum);}],['배당주기',function(r){return ff(r.freq);}],['배당수익률',function(r){return fp(yOf(r));}],['LTV',function(r){return fp(r.ltv);}],['임대율',function(r){return fp(r.occ);}],['WALE',function(r){return fy(r.wale);}],['고정금리',function(r){return fp(r.fixed);}],['신용등급',function(r){return r.rating||'—';}],['건강신호',function(r){return ({ok:'안정',warn:'주의',risk:'위험'})[r.health];}],['주요임차인',function(r){return r.tenant||'—';}]];
    var h='<table class="cmptbl"><thead><tr><th>지표</th>'+rs.map(function(r){return '<th><a href="r/'+r.t+'/" style="text-decoration:none">'+esc(r.name)+'</a></th>';}).join('')+'</tr></thead><tbody>';
    h+=metrics.map(function(m){return '<tr><td>'+m[0]+'</td>'+rs.map(function(r){return '<td>'+esc(m[1](r))+'</td>';}).join('')+'</tr>';}).join('');
    h+='</tbody></table>';
    document.getElementById('cmpbody').innerHTML=h;
    document.getElementById('modal').className='modal show';
  }
  function syncTools(){
    [].slice.call(tb.querySelectorAll('tr')).forEach(function(tr){
      var tk=tr.dataset.tk;var pin=tr.querySelector('.pin');if(pin)pin.className='pin'+(state.pins[tk]?' on':'');
      tr.className=state.pins[tk]?'pinned':'';
      var cb=tr.querySelector('.csel input');if(cb)cb.checked=!!state.sel[tk];
    });
  }
  function render(){
    var vis=FACTS.filter(passes);vis.sort(cmp);
    vis.forEach(function(r){var tr=trByTk[r.t];if(tr)tb.appendChild(tr);});
    var visSet={};vis.forEach(function(r){visSet[r.t]=1;});
    [].slice.call(tb.querySelectorAll('tr')).forEach(function(tr){tr.style.display=visSet[tr.dataset.tk]?'':'none';});
    empty.hidden=vis.length>0;
    document.getElementById('count').innerHTML='<b>'+vis.length+'</b>개 표시 / 전체 '+FACTS.length+'개';
    footer(vis);applyHide();syncTools();
    if(!document.getElementById('scatter').hidden)scatter(vis);
    if(!document.getElementById('sector').hidden)sector(vis);
    if(state.view==='card')cards(vis);
    writeUrl();
  }
  function setSort(key,ty){if(state.key===key)state.dir=-state.dir;else{state.dir=(key==='name'||key==='type')?1:-1;state.key=key;}
    [].slice.call(tbl.querySelectorAll('th.sortable')).forEach(function(th){th.classList.remove('asc','desc');if(th.dataset.key===key)th.classList.add(state.dir>0?'asc':'desc');});render();}

  // 프리셋 칩
  document.getElementById('pchips').innerHTML=PRESETS.map(function(p){return '<button class="pchip" data-p="'+p.k+'">'+esc(p.l)+'</button>';}).join('');
  // 열 메뉴
  document.getElementById('colpop').innerHTML=COLS.filter(function(c){return c[0]!=='name';}).map(function(c){return '<label><input type="checkbox" data-c="'+c[0]+'" checked> '+esc(c[1])+'</label>';}).join('');

  // 이벤트
  [].slice.call(tbl.querySelectorAll('th.sortable')).forEach(function(th){function go(){setSort(th.dataset.key,th.dataset.ty);}th.addEventListener('click',go);th.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();go();}});});
  document.getElementById('q').addEventListener('input',function(e){state.q=e.target.value;render();});
  document.getElementById('fchips').addEventListener('click',function(e){var b=e.target.closest('.fchip');if(!b)return;var t=b.dataset.type;
    if(t===''){state.types={};}else{if(state.types[t])delete state.types[t];else state.types[t]=true;}
    var all=Object.keys(state.types).length===0;
    [].slice.call(this.children).forEach(function(c){var ct=c.dataset.type;c.classList.toggle('on',ct===''?all:!!state.types[ct]);});render();});
  document.getElementById('hchips').addEventListener('click',function(e){var b=e.target.closest('.hchip');if(!b)return;state.h=b.dataset.h;[].slice.call(this.children).forEach(function(c){c.classList.toggle('on',c===b);});render();});
  document.getElementById('pchips').addEventListener('click',function(e){var b=e.target.closest('.pchip');if(!b)return;var k=b.dataset.p;if(state.presets[k])delete state.presets[k];else state.presets[k]=true;b.classList.toggle('on',!!state.presets[k]);render();});
  document.getElementById('viewseg').addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;state.view=b.dataset.view;[].slice.call(this.children).forEach(function(c){c.classList.toggle('on',c===b);});
    document.getElementById('tblwrap').hidden=state.view!=='table';document.getElementById('fcards').hidden=state.view!=='card';render();});
  function toggleBtn(id,prop,after){document.getElementById(id).addEventListener('click',function(){state[prop]=!state[prop];this.classList.toggle('on',state[prop]);if(after)after();});}
  toggleBtn('bHeat','heat',decor);toggleBtn('bBars','bars',decor);
  document.getElementById('bScatter').addEventListener('click',function(){var p=document.getElementById('scatter');p.hidden=!p.hidden;this.classList.toggle('on',!p.hidden);if(!p.hidden)scatter(FACTS.filter(passes).sort(cmp));});
  function fillSel(id,opts){var s=document.getElementById(id);s.innerHTML=opts.map(function(k){return '<option value="'+k+'"'+(k===state[id]?' selected':'')+'>'+esc(METRICS[k].l)+'</option>';}).join('');}
  ['scx','scy','scsz'].forEach(function(id){var el=document.getElementById(id);el.addEventListener('change',function(){state[id]=this.value;if(!document.getElementById('scatter').hidden)scatter(FACTS.filter(passes).sort(cmp));writeUrl();});});
  document.getElementById('bSector').addEventListener('click',function(){var p=document.getElementById('sector');p.hidden=!p.hidden;this.classList.toggle('on',!p.hidden);if(!p.hidden)sector(FACTS.filter(passes));});
  document.getElementById('bCols').addEventListener('click',function(e){e.stopPropagation();var p=document.getElementById('colpop');p.hidden=!p.hidden;});
  document.addEventListener('click',function(){document.getElementById('colpop').hidden=true;});
  document.getElementById('colpop').addEventListener('click',function(e){e.stopPropagation();var cb=e.target.closest('input');if(!cb)return;var k=cb.dataset.c;if(cb.checked)delete state.hide[k];else state.hide[k]=true;applyHide();writeUrl();});
  document.getElementById('bCsv').addEventListener('click',function(){
    var vis=FACTS.filter(passes).sort(cmp);var vc=COLS.filter(function(c){return !state.hide[c[0]];});
    var lines=[vc.map(function(c){return c[1];}).join(',')];
    vis.forEach(function(r){lines.push(vc.map(function(c){return csvVal(r,c[0]);}).join(','));});
    var blob=new Blob(['\\ufeff'+lines.join('\\n')],{type:'text/csv;charset=utf-8'});
    var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='reits-facts.csv';document.body.appendChild(a);a.click();a.parentNode.removeChild(a);
  });
  function csvVal(r,k){var v;
    if(k==='name')v=r.name+' ('+r.t+')';else if(k==='type')v=r.type;else if(k==='health')v=({ok:'안정',warn:'주의',risk:'위험'})[r.health];
    else if(k==='div')v=ff(r.freq)+(r.annual?(' 실적'+Math.round(r.annual)+'원'):'');else if(k==='yld')v=yOf(r)==null?'':yOf(r);
    else if(k==='rating')v=r.rating||'';else if(k==='tenant')v=r.tenant||'';else v=r[k]==null?'':r[k];
    v=String(v);if(/[",\\n]/.test(v))v='"'+v.replace(/"/g,'""')+'"';return v;}

  // 행 도구(핀·선택) 주입
  [].slice.call(tb.querySelectorAll('tr')).forEach(function(tr){
    var nc=tr.querySelector('.namec');if(!nc)return;var tk=tr.dataset.tk;
    var tools=document.createElement('div');tools.className='nc-tools';
    tools.innerHTML='<button class="pin" title="상단 고정" aria-label="상단 고정">★</button><label class="csel" title="비교 선택"><input type="checkbox" aria-label="비교 선택"></label>';
    nc.insertBefore(tools,nc.firstChild);
    tools.querySelector('.pin').addEventListener('click',function(ev){ev.preventDefault();if(state.pins[tk])delete state.pins[tk];else state.pins[tk]=true;try{localStorage.setItem(PIN,JSON.stringify(state.pins));}catch(e){}render();});
    tools.querySelector('input').addEventListener('change',function(){if(this.checked)state.sel[tk]=true;else delete state.sel[tk];cmpbar();});
  });
  document.getElementById('cmpgo').addEventListener('click',openCmp);
  document.getElementById('cmpclr').addEventListener('click',function(){state.sel={};syncTools();cmpbar();});
  document.getElementById('mclose').addEventListener('click',function(){document.getElementById('modal').className='modal';});
  document.getElementById('modal').addEventListener('click',function(e){if(e.target===this)this.className='modal';});

  // 다크 모드
  var dk=document.getElementById('dk');
  function applyTheme(t){if(t)document.documentElement.setAttribute('data-theme',t);else document.documentElement.removeAttribute('data-theme');dk.textContent=(t==='dark'||(!t&&window.matchMedia&&window.matchMedia('(prefers-color-scheme:dark)').matches))?'☀️':'🌙';}
  try{applyTheme(localStorage.getItem('facts_theme'));}catch(e){}
  dk.addEventListener('click',function(){var cur=document.documentElement.getAttribute('data-theme');var nx=cur==='dark'?'light':'dark';applyTheme(nx);try{localStorage.setItem('facts_theme',nx);}catch(e){}});

  // URL 상태(공유·북마크)
  function writeUrl(){var p=[];if(state.q)p.push('q='+encodeURIComponent(state.q));
    var ty=Object.keys(state.types);if(ty.length)p.push('type='+encodeURIComponent(ty.join(',')));
    if(state.h)p.push('h='+state.h);var pr=Object.keys(state.presets);if(pr.length)p.push('p='+pr.join(','));
    if(!(state.key==='aum'&&state.dir===-1))p.push('sort='+state.key+'.'+(state.dir>0?'a':'d'));
    if(state.view!=='table')p.push('view='+state.view);if(state.heat)p.push('heat=1');if(state.bars)p.push('bars=1');
    var hd=Object.keys(state.hide);if(hd.length)p.push('hide='+hd.join(','));
    if(state.scx!=='ltv')p.push('scx='+state.scx);if(state.scy!=='yld')p.push('scy='+state.scy);if(state.scsz!=='aum')p.push('scsz='+state.scsz);
    var h=p.join('&');try{history.replaceState(null,'',h?('#'+h):location.pathname+location.search);}catch(e){}}
  function readUrl(){var h=location.hash.replace(/^#/,'');if(!h)return;h.split('&').forEach(function(kv){var i=kv.indexOf('='),k=i<0?kv:kv.slice(0,i),v=i<0?'':decodeURIComponent(kv.slice(i+1));
    if(k==='q')state.q=v;else if(k==='type'){v.split(',').forEach(function(x){if(x)state.types[x]=true;});}
    else if(k==='h')state.h=v;else if(k==='p'){v.split(',').forEach(function(x){if(x)state.presets[x]=true;});}
    else if(k==='sort'){var s=v.split('.');state.key=s[0];state.dir=s[1]==='a'?1:-1;}
    else if(k==='view')state.view=v;else if(k==='heat')state.heat=true;else if(k==='bars')state.bars=true;
    else if(k==='hide'){v.split(',').forEach(function(x){if(x)state.hide[x]=true;});}
    else if(k==='scx'&&METRICS[v])state.scx=v;else if(k==='scy'&&METRICS[v])state.scy=v;else if(k==='scsz'&&METRICS[v])state.scsz=v;});}
  function syncControls(){
    document.getElementById('q').value=state.q;
    [].slice.call(document.querySelectorAll('#fchips .fchip')).forEach(function(c){var ct=c.dataset.type;c.classList.toggle('on',ct===''?Object.keys(state.types).length===0:!!state.types[ct]);});
    [].slice.call(document.querySelectorAll('#hchips .hchip')).forEach(function(c){c.classList.toggle('on',c.dataset.h===state.h);});
    [].slice.call(document.querySelectorAll('#pchips .pchip')).forEach(function(c){c.classList.toggle('on',!!state.presets[c.dataset.p]);});
    [].slice.call(document.querySelectorAll('#viewseg button')).forEach(function(c){c.classList.toggle('on',c.dataset.view===state.view);});
    document.getElementById('tblwrap').hidden=state.view!=='table';document.getElementById('fcards').hidden=state.view!=='card';
    document.getElementById('bHeat').classList.toggle('on',state.heat);document.getElementById('bBars').classList.toggle('on',state.bars);
    [].slice.call(document.querySelectorAll('#colpop input')).forEach(function(cb){cb.checked=!state.hide[cb.dataset.c];});
    [].slice.call(tbl.querySelectorAll('th.sortable')).forEach(function(th){th.classList.remove('asc','desc');if(th.dataset.key===state.key)th.classList.add(state.dir>0?'asc':'desc');});
    fillSel('scx',AXOPT);fillSel('scy',AXOPT);fillSel('scsz',SZOPT);
  }

  // 라이브 배당수익률(시세 연동) — 실패 시 공시값 유지
  function fetchLive(){if(!window.fetch)return;
    fetch(API+'/v1/reits').then(function(r){return r.json();}).then(function(j){var list=(j&&j.reits)||[];var any=false;
      list.forEach(function(x){var r=byTk[x.ticker];if(r&&x.yieldPriceBasis!=null){r.yldLive=x.yieldPriceBasis;any=true;}});
      if(any){state.live=true;markLive();render();}
    }).catch(function(){});}
  function markLive(){[].slice.call(tb.querySelectorAll('tr')).forEach(function(tr){var r=byTk[tr.dataset.tk];if(!r||r.yldLive==null)return;
    tr.dataset.yld=r.yldLive;var td=tr.querySelector('td[data-col="yld"] .cv');if(td)td.innerHTML=fp(r.yldLive)+' <span class="lvb">실시간</span>';});}

  var hadView=/(?:^|#|&)view=/.test(location.hash);
  readUrl();
  if(!hadView&&window.innerWidth<720)state.view='card'; // 모바일 기본 카드 뷰
  syncControls();render();decor();fetchLive();
})();
</script>
</body>
</html>`;
}

// ---- 생성 ----
// 상장 인프라펀드(맥쿼리인프라 등) 페이지 — 리츠와 다른 별도 템플릿. P/NAV·WALE·건강신호 미적용.
function infraPage(x) {
  const url = BASE + '/r/' + x.ticker + '/';
  const m = x.market || {};
  const title = `${x.shortName || x.name} (${x.ticker}) — 인프라펀드 시세·정보 | 리츠온 REITs ON`;
  const desc = `${x.shortName || x.name}: 국내 유일 상장 인프라펀드(리츠 아님). ${x.assetText}. 시세·52주·확인 포인트·공식 출처. (교육용, 투자 권유 아님)`;
  const p52 = week52Position(m.price, m.week52Low, m.week52High);
  const cp = m.changePct;
  const chg = (cp != null) ? ` <span style="color:${cp > 0 ? '#d1453b' : cp < 0 ? '#1f6feb' : 'var(--muted)'};font-weight:800">${cp > 0 ? '+' : ''}${cp}%</span>` : '';
  const spark = sparklineSvg(PRICE_HISTORY[x.ticker], { w: 260, h: 46 });
  const strip = [
    m.price != null ? `<div class="ns-cell"><div class="ns-k">현재가</div><div class="ns-v">${fmt(m.price)}원</div><div class="ns-sub">${cp != null ? (cp > 0 ? '+' : '') + cp + '%' : ''} · 실시간 아님</div></div>` : '',
    p52 ? `<div class="ns-cell"><div class="ns-k">52주 위치</div><div class="ns-v">${p52.posPct}%</div><div class="ns-sub">저점 +${p52.fromLowPct}% · 고점 −${p52.offHighPct}%</div></div>` : '',
    `<div class="ns-cell"><div class="ns-k">분배</div><div class="ns-v">반기</div><div class="ns-sub">${(x.divMonths || []).map((mm) => mm + '월').join('·')}</div></div>`,
  ].filter(Boolean).join('');
  const ld = { '@context': 'https://schema.org', '@type': 'WebPage', name: title, url, inLanguage: 'ko', description: desc, isPartOf: { '@type': 'WebSite', name: '리츠온 REITs ON', url: BASE + '/' } };
  return `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}" />
<link rel="canonical" href="${url}" /><link rel="icon" href="../../favicon.svg" type="image/svg+xml" />
<meta property="og:type" content="article" /><meta property="og:title" content="${esc((x.shortName || x.name) + ' · 인프라펀드')}" />
<meta property="og:description" content="${esc(desc)}" /><meta property="og:url" content="${url}" /><meta property="og:image" content="${url}og.png" />
<meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" /><meta name="twitter:card" content="summary_large_image" /><meta name="twitter:image" content="${url}og.png" />
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<style>
:root{--brand:#3254ff;--bg:#f5f7fb;--surface:#fff;--text:#172033;--muted:#515b72;--line:#e5e9f2;--soft:#eef1f7;--tint:#edf1ff}
*{box-sizing:border-box}body{margin:0;font-family:'Pretendard','Apple SD Gothic Neo','Malgun Gothic',system-ui,sans-serif;background:var(--bg);color:var(--text);line-height:1.6}
.wrap{max-width:760px;margin:0 auto;padding:20px 18px 60px}
.top{display:flex;align-items:center;gap:10px;padding:14px 0}
.logo{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#3254ff,#00a78e);color:#fff;font-weight:900;display:grid;place-items:center;text-decoration:none}
.top a.brand{color:var(--text);text-decoration:none;font-weight:800}.top .topfacts{margin-left:auto;font-size:12.5px;font-weight:700;color:var(--brand);background:var(--tint);border-radius:999px;padding:6px 12px;text-decoration:none}
.eyebrow{display:inline-block;font-size:12px;font-weight:800;color:#8a5a00;background:#fdf2d8;border-radius:999px;padding:5px 12px}
h1{font-size:28px;letter-spacing:-1px;margin:14px 0 4px}.tk{color:var(--muted);font-weight:700}
.card{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin-top:14px}
.numstrip{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0 4px}
.ns-cell{border:1px solid var(--line);border-radius:12px;padding:10px 8px;background:linear-gradient(180deg,#fbfcff,#fff);text-align:center;min-width:0}
.ns-k{font-size:10.5px;font-weight:800;color:var(--muted)}.ns-v{font-size:20px;font-weight:950;letter-spacing:-.03em;margin:3px 0 2px}.ns-sub{font-size:10px;color:var(--muted);font-weight:600}
.notbox{border:1px solid #f2e0a8;background:#fdf6e3;border-radius:14px;padding:14px 16px;margin-top:14px;font-size:14px}
.notbox b{color:#8a5a00}
h2{font-size:18px;margin:0 0 8px}ul.q{margin:6px 0 0;padding-left:18px}ul.q li{margin:6px 0}
.links{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.links a{display:inline-block;border:1px solid var(--line);background:var(--surface);border-radius:999px;padding:9px 14px;text-decoration:none;color:var(--text);font-weight:700;font-size:14px}
.spark{display:flex;align-items:center;gap:8px;margin-top:8px}.spark svg{max-width:100%;height:auto}.muted{color:var(--muted)}.small{font-size:12.5px}
.note{font-size:12.5px;color:var(--muted);margin-top:18px;line-height:1.6}a.more{color:var(--brand);font-weight:800;text-decoration:none}
</style></head><body>
<div class="wrap">
  <div class="top"><a class="logo" href="../../">R</a><a class="brand" href="../../">리츠온 REITs ON</a><a class="topfacts" href="../../facts.html">📊 팩트시트</a></div>
  <span class="eyebrow">인프라펀드 · 리츠 아님</span>
  <h1>${esc(x.name)}</h1>
  <div class="tk">종목코드 ${esc(x.ticker)} · ${esc(x.assetText)}</div>
  <div class="numstrip">${strip}</div>
  ${spark ? `<div class="card"><div class="spark">${spark}<span class="muted small">최근 1년 주가 · ${m.priceAsOf ? esc(m.priceAsOf) + ' 종가' : ''} 실시간 아님</span></div></div>` : ''}
  <div class="notbox">⚠ <b>이 종목은 리츠(부동산투자회사)가 아닙니다.</b> ${esc(x.vsReit || '')} 따라서 이 사이트의 리츠 지표(실배당 TTM·P/NAV·건강신호)는 표시하지 않습니다.</div>
  <div class="card"><h2>무엇인가요?</h2><p style="margin:0;color:var(--muted)">${esc(x.note || '')}</p><div class="tk" style="margin-top:8px;font-size:13px">근거법 ${esc(x.law || '-')} · 운용 ${esc(x.manager || '-')}</div></div>
  <div class="card"><h2>확인 포인트</h2><ul class="q">${(x.checkpoints || []).map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>
  <div class="card"><h2>분배금·재무는 공식 자료에서</h2><p class="muted small" style="margin:0 0 8px">분배금 이력·재무는 추정하지 않고 공식 출처로 연결합니다. 최신 분배금·기준일·재원은 아래에서 확인하세요.</p><div class="links">${(x.sources || []).map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)} →</a>`).join('')}</div></div>
  <p class="note">⚠ 교육용 정보이며 특정 종목의 매수·매도 추천이 아닙니다. 시세는 최근 종가(비공식·참고용)이며 실시간이 아닙니다. 투자 전 공식 IR·DART 원문을 확인하세요.</p>
  <p class="note"><a class="more" href="../../">← 리츠온 홈으로</a></p>
</div></body></html>`;
}

// ---- 공용 랜딩 셸(신뢰·섹터 페이지 공통 HTML 뼈대) ----
// rel: 루트까지 상대경로('../'=/about/, '../../'=/s/x/). 종목 페이지와 동일 디자인 토큰 사용.
function landingShell({ title, desc, canonical, rel, ld, body }) {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<link rel="canonical" href="${canonical}" />
<link rel="icon" href="${rel}favicon.svg" type="image/svg+xml" />
<meta name="theme-color" content="#3254ff" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:url" content="${canonical}" />
<meta property="og:image" content="${BASE}/og.png" />
<meta name="twitter:card" content="summary_large_image" /><meta name="twitter:image" content="${BASE}/og.png" />
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<style>
:root{--brand:#3254ff;--bg:#f5f7fb;--surface:#fff;--text:#172033;--muted:#515b72;--line:#e5e9f2;--soft:#eef1f7;--tint:#edf1ff}
*{box-sizing:border-box}body{margin:0;font-family:'Pretendard','Apple SD Gothic Neo','Malgun Gothic',system-ui,sans-serif;background:var(--bg);color:var(--text);line-height:1.65}
.wrap{max-width:760px;margin:0 auto;padding:20px 18px 60px}
.top{display:flex;align-items:center;gap:10px;padding:14px 0}
.logo{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#3254ff,#00a78e);color:#fff;font-weight:900;display:grid;place-items:center;text-decoration:none}
.top a.brand{color:var(--text);text-decoration:none;font-weight:800}
.top .topfacts{margin-left:auto;font-size:12.5px;font-weight:700;color:var(--brand);text-decoration:none;background:var(--tint);border-radius:999px;padding:6px 12px}
.crumb{font-size:12.5px;color:var(--muted);margin:2px 0 0}.crumb a{color:var(--brand);text-decoration:none;font-weight:700}
.eyebrow{display:inline-block;font-size:12px;font-weight:800;color:var(--brand);background:var(--tint);border-radius:999px;padding:5px 12px;margin-top:6px}
h1{font-size:27px;letter-spacing:-1px;margin:12px 0 6px}
.lead{color:var(--muted);font-size:15px;margin:0 0 4px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin-top:14px}
.card h2{font-size:17px;margin:0 0 10px}
.card h3{font-size:14px;margin:14px 0 4px}
.card p{margin:6px 0}
ul.q{margin:8px 0 0;padding-left:18px}ul.q li{margin:6px 0}
.rows{display:grid;gap:0}.row{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--soft);font-size:14.5px}.row:last-child{border-bottom:0}.row span{color:var(--muted)}.row b{font-weight:800;text-align:right}
.muted{color:var(--muted)}.small{font-size:12.5px}
a.more{color:var(--brand);text-decoration:none;font-weight:700}
.note{font-size:12px;color:var(--muted);margin:14px 2px 0;line-height:1.55}
.slist{display:grid;gap:12px;margin-top:6px}
.sitem{border:1px solid var(--line);border-radius:14px;padding:14px 15px;background:var(--surface);text-decoration:none;color:inherit;display:block}
.sitem:hover{border-color:#c9d3ee}
.sitem .snm{font-weight:900;font-size:16px;letter-spacing:-.02em}
.sitem .stk{color:var(--muted);font-weight:700;font-size:12px;margin-left:6px}
.sitem .snote{color:var(--muted);font-size:12.5px;margin:4px 0 0}
.sbadge{display:inline-block;font-size:10.5px;font-weight:800;border-radius:999px;padding:2px 8px;margin-left:6px;vertical-align:middle}
.sbadge.risk{background:#fdecea;color:#b42318}.sbadge.warn{background:#fdf6e3;color:#9a6700}
.chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:8px}
.chips a{font-size:12.5px;font-weight:800;color:var(--brand);background:var(--tint);border-radius:999px;padding:6px 12px;text-decoration:none}
.numstrip{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0 2px}
@media(max-width:420px){.numstrip{gap:6px}}
.ns-cell{border:1px solid var(--line);border-radius:12px;padding:10px 8px;background:linear-gradient(180deg,#fbfcff,#fff);text-align:center;min-width:0}
.ns-k{font-size:10.5px;font-weight:800;color:var(--muted);line-height:1.25;display:flex;flex-direction:column;align-items:center;gap:1px}
.ns-t{font-size:9px;font-weight:700;opacity:.7}
.ns-v{font-size:20px;font-weight:950;letter-spacing:-.03em;margin:3px 0 2px;line-height:1.1}
@media(max-width:420px){.ns-v{font-size:17px}}
.ns-v.t-warn{color:#9a6700}
.ns-sub{font-size:10px;color:var(--muted);font-weight:600;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <a class="logo" href="${rel}" aria-label="리츠온 홈">R</a>
    <a class="brand" href="${rel}">리츠온 REITs ON</a>
    <a class="topfacts" href="${rel}facts.html">📊 팩트시트</a>
  </div>
${body}
  <p class="note">⚠ 리츠온은 일반 투자자를 위한 <b>교육·정보 제공 서비스</b>이며, 특정 종목의 매수·매도 추천이나 투자자문이 아닙니다. 모든 수치는 공개자료 기반이며 실제와 다를 수 있고, 리츠는 배당 삭감·중단 및 원금 손실이 가능합니다. 투자 전 DART·KIND·투자보고서 원문과 최신 시세를 반드시 확인하세요.</p>
  <p class="note"><a class="more" href="${rel}">← 리츠온 홈으로</a> · <a class="more" href="${rel}about/">이 사이트 소개·데이터 방법론</a></p>
</div>
</body>
</html>`;
}

// 종목 한 줄(섹터 목록용): numStrip 재사용 + 리스크 배지.
function reitListItem(r) {
  const badge = r.risk ? `<span class="sbadge ${r.risk.level === 'high' ? 'risk' : 'warn'}">${esc(r.risk.label)}</span>` : '';
  return `<a class="sitem" href="../../r/${r.ticker}/">
    <div><span class="snm">${esc(r.name)}</span><span class="stk">${r.ticker}</span>${badge}</div>
    ${numStrip(r)}
    <div class="snote">${esc(r.note || '')}</div>
  </a>`;
}

// ---- 섹터 랜딩 페이지 ----
function sectorPage(sectorName, meta, list) {
  const url = `${BASE}/s/${meta.slug}/`;
  const title = `${sectorName} 리츠 총정리 (${list.length}개) · 배당·특징·확인 포인트 | 리츠온`;
  const desc = `국내 상장 ${sectorName} 리츠 ${list.length}개의 실배당수익률(TTM)·P/NAV·배당월과 ${sectorName} 리츠 투자 시 확인 포인트. ${meta.lead} (교육용 정보, 투자 권유 아님)`;
  const ld = {
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, url, inLanguage: 'ko', description: desc,
    isPartOf: { '@type': 'WebSite', name: '리츠온 REITs ON', url: BASE + '/' },
    mainEntity: {
      '@type': 'ItemList', numberOfItems: list.length,
      itemListElement: list.map((r, i) => ({ '@type': 'ListItem', position: i + 1, name: r.name, url: `${BASE}/r/${r.ticker}/` })),
    },
  };
  const others = Object.entries(SECTOR_META).filter(([k]) => k !== sectorName)
    .map(([k, m]) => `<a href="../${m.slug}/">${k} 리츠</a>`).join('');
  const body = `  <p class="crumb"><a href="../../">홈</a> › ${esc(sectorName)} 리츠</p>
  <span class="eyebrow">섹터 가이드 · 교육용</span>
  <h1>${esc(sectorName)} 리츠 (${list.length}개)</h1>
  <p class="lead">${esc(meta.lead)}</p>
  <div class="card">
    <h2>${esc(sectorName)} 리츠, 투자 전 확인 포인트</h2>
    <ul class="q">${meta.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
    <p class="small muted" style="margin-top:10px">아래 수치는 <b>공시 실지급 배당 기준 실배당수익률(TTM)</b>과 <b>장부 순자산 대비 주가(P/NAV)</b>입니다. 순위·추천이 아니라 같은 섹터를 나란히 비교하기 위한 참고값이며, 종목명을 누르면 자산·재무·공시 확인 포인트를 볼 수 있습니다.</p>
  </div>
  <div class="slist">${list.map(reitListItem).join('')}</div>
  <div class="card">
    <h2>다른 섹터 리츠</h2>
    <div class="chips">${others}</div>
  </div>`;
  return landingShell({ title, desc, canonical: url, rel: '../../', ld, body });
}

// ---- 신뢰·방법론·면책(/about/) 페이지: E-E-A-T ----
function aboutPage() {
  const url = `${BASE}/about/`;
  const title = '리츠온 소개 · 데이터 방법론 · 면책 | 리츠온 REITs ON';
  const desc = '리츠온은 국내 상장리츠 25개를 다루는 교육용 정보 서비스입니다. 데이터 수집원(DART·한국거래소·한국리츠협회·Yahoo Finance)과 갱신 주기, 실배당수익률(TTM)·P/NAV 산정 방법, 그리고 하지 않는 것(추천·순위 없음)을 투명하게 밝힙니다.';
  const faqs = [
    { q: '리츠온은 종목을 추천하나요?', a: '아니요. 리츠온은 매수·매도 추천, 종합점수·순위, 목표주가를 제공하지 않습니다. 사실(배당·재무·공시)과 그 출처를 정리해 이용자가 스스로 판단하도록 돕는 교육용 서비스입니다. 이는 유사투자자문업이 아닙니다.' },
    { q: '실배당수익률(TTM)은 어떻게 계산하나요?', a: '최근 12개월간 실제로 지급된 주당 배당금의 합을 현재가로 나눈 값입니다. 미래 배당을 가정한 추정치가 아니라 공시된 실지급액 기준이며, 특별배당 포함·배당성향 100% 초과·이력 부족 등은 배지로 따로 표시합니다.' },
    { q: 'P/NAV는 어떻게 계산하나요?', a: '현재가를 장부상 주당순자산(자본총계 ÷ 발행주식수)으로 나눈 값입니다. 시가 재평가가 아닌 장부 기준이며, 발행주식수·순자산을 확인할 수 없는 종목은 "산정중"으로 비워 둡니다.' },
    { q: '데이터는 얼마나 자주 갱신되나요?', a: '시세는 매일 오전 6시 20분과 평일 장마감 후 오후 4시 30분(KST)에 자동 수집합니다. 배당·재무·공시는 DART·투자보고서 공시를 기준으로 반영하며, 각 수치에는 기준일을 함께 표기합니다.' },
    { q: '시세는 실시간인가요?', a: '아니요. 표시되는 시세는 비공식 소스의 최근 종가로 참고용이며 실시간이 아닙니다. 매매 판단 전에는 반드시 증권사 HTS/MTS의 실시간 시세를 확인하세요.' },
  ];
  const ld = [
    { '@context': 'https://schema.org', '@type': 'AboutPage', name: title, url, inLanguage: 'ko', description: desc,
      isPartOf: { '@type': 'WebSite', name: '리츠온 REITs ON', url: BASE + '/' },
      publisher: { '@type': 'Organization', name: '리츠온 REITs ON', url: BASE + '/' } },
    { '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
  ];
  const sectorChips = Object.entries(SECTOR_META).map(([k, m]) => `<a href="../s/${m.slug}/">${k} 리츠</a>`).join('');
  const body = `  <p class="crumb"><a href="../">홈</a> › 소개·방법론</p>
  <span class="eyebrow">사이트 소개 · 데이터 방법론</span>
  <h1>리츠온을 이렇게 만듭니다</h1>
  <p class="lead">국내 상장리츠 25개(+상장 인프라펀드)를 다루는 <b>교육용 정보 서비스</b>입니다. 숫자마다 출처와 기준일을 붙이고, 추천 대신 사실을 정리합니다.</p>

  <div class="card">
    <h2>무엇을 하는가</h2>
    <div class="rows">
      <div class="row"><span>다루는 대상</span><b>국내 상장리츠 25개 + 상장 인프라펀드</b></div>
      <div class="row"><span>핵심 지표</span><b>실배당수익률(TTM) · P/NAV · 배당 캘린더 · 공시</b></div>
      <div class="row"><span>목적</span><b>스스로 판단하도록 돕는 교육·정보 제공</b></div>
      <div class="row"><span>비용</span><b>무료(제3자 광고·제휴 링크 게재 가능)</b></div>
    </div>
  </div>

  <div class="card">
    <h2>데이터 출처</h2>
    <p class="small muted" style="margin:0 0 8px">모든 수치는 아래 공개자료를 근거로 하며, 화면 곳곳에 원문 링크와 기준일을 함께 제공합니다.</p>
    <div class="rows">
      <div class="row"><span>공시·재무·배당</span><b><a class="more" href="https://dart.fss.or.kr/" target="_blank" rel="noopener">DART 전자공시</a> · <a class="more" href="https://kind.krx.co.kr/" target="_blank" rel="noopener">KIND 한국거래소</a></b></div>
      <div class="row"><span>시장 통계</span><b><a class="more" href="https://www.kareit.or.kr/" target="_blank" rel="noopener">한국리츠협회(KAREIT)</a> · <a class="more" href="https://reits.molit.go.kr/" target="_blank" rel="noopener">국토부 리츠정보시스템</a></b></div>
      <div class="row"><span>시세(참고·비공식)</span><b>Yahoo Finance(최근 종가)</b></div>
      <div class="row"><span>세제</span><b><a class="more" href="https://www.nts.go.kr/" target="_blank" rel="noopener">국세청</a></b></div>
    </div>
  </div>

  <div class="card">
    <h2>지표는 이렇게 계산합니다</h2>
    <h3>실배당수익률 (TTM)</h3>
    <p class="small">최근 12개월간 <b>실제로 지급된</b> 주당 배당금의 합 ÷ 현재가. 미래 배당을 가정한 추정이 아니라 공시 실지급 기준입니다. 특별배당 포함, 배당성향 100% 초과, 이력 부족 등은 <b>배지</b>로 구분해 표시합니다.</p>
    <h3>P/NAV (장부 순자산 대비 주가)</h3>
    <p class="small">현재가 ÷ 장부상 주당순자산(자본총계 ÷ 발행주식수). 시가 재평가가 아닌 장부 기준이며, 발행주식수·순자산 확인이 어려운 종목은 "산정중"으로 비워 둡니다. 1배 미만이면 장부 대비 할인입니다.</p>
    <h3>배당 캘린더</h3>
    <p class="small">결산월 기준의 <b>예상</b> 배당기준월입니다(확정 기준일은 공시로 별도 확인). 확정 아님을 명시합니다.</p>
    <h3>갱신 주기</h3>
    <p class="small">시세는 매일 06:20, 평일 16:30(KST) 자동 수집. 배당·재무·공시는 DART·투자보고서를 기준으로 반영하며 수치마다 기준일을 표기합니다.</p>
  </div>

  <div class="card">
    <h2>하지 않는 것</h2>
    <ul class="q">
      <li>매수·매도 추천, 목표주가, 종합점수·순위를 제공하지 않습니다.</li>
      <li>출처가 확인되지 않는 수치를 만들어 넣지 않습니다("산정중"으로 비웁니다).</li>
      <li>시세를 실시간으로 제공하지 않습니다(참고용 최근 종가).</li>
      <li>이용자가 입력한 내용(관심리츠·포트폴리오·공시 붙여넣기)은 이 브라우저에만 저장하며 서버로 전송하지 않습니다.</li>
    </ul>
  </div>

  <div class="card">
    <h2>섹터별로 둘러보기</h2>
    <div class="chips">${sectorChips}</div>
  </div>

  <div class="card">
    <h2>면책</h2>
    <p class="small muted">리츠온이 제공하는 정보는 일반적인 교육·정보 제공을 위한 것으로, 특정 종목의 투자 권유나 자문이 아닙니다. 정보의 정확성·완전성을 보장하지 않으며, 투자 판단과 그 결과에 대한 책임은 이용자 본인에게 있습니다. 리츠는 부동산 경기·금리·공실·임차인 신용에 따라 배당이 삭감·중단될 수 있고 원금 손실이 발생할 수 있습니다. 투자 전 반드시 공식 공시와 최신 시세를 확인하세요.</p>
  </div>`;
  return landingShell({ title, desc, canonical: url, rel: '../', ld, body });
}

// ---- 최근 변화(/changes/) 페이지: 홈은 7일 요약, 여기는 30일 전체 로그 + 유형 필터 ----
const CHG_KIND = { low: ['52주 신저가', '#b42318', '#fdecea'], move: ['급등락', '#9a6700', '#fdf6e3'], pnav: ['P/NAV 이동', '#3254ff', '#edf1ff'], div: ['배당 공시', '#0c7a54', '#e4f5ec'], filing: ['공시', '#515b72', '#eef1f7'] };
function changesPage() {
  let events = [];
  try { events = JSON.parse(readFileSync(join(ROOT, 'data', 'changes.json'), 'utf8')).events || []; } catch { /* 최초 */ }
  const url = `${BASE}/changes/`;
  const title = '상장리츠 최근 변화 30일 · 신저가·급등락·P/NAV·공시 | 리츠온';
  const desc = `국내 상장리츠 25개의 최근 30일 변화 로그(${events.length}건): 52주 신저가, 하루 ±4% 급등락, P/NAV 구간 이동, 주요 공시. 자동 수집한 사실만 기록하며 해석·추천이 아닙니다.`;
  const ld = { '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, url, inLanguage: 'ko', description: desc, isPartOf: { '@type': 'WebSite', name: '리츠온 REITs ON', url: BASE + '/' } };
  const byDate = {};
  for (const e of events) { (byDate[e.date] = byDate[e.date] || []).push(e); }
  const dates = Object.keys(byDate).sort().reverse();
  const chip = (k, lab) => `<button class="fchip" type="button" data-kind="${k}">${lab}</button>`;
  const groups = dates.map((d) => `
    <div class="dgroup" data-date="${d}">
      <div class="dhead">${d.slice(0, 4)}년 ${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일</div>
      ${byDate[d].map((e) => {
        const [lab, col, bg] = CHG_KIND[e.kind] || CHG_KIND.filing;
        const ext = e.url ? ` <a class="dartl" href="${esc(e.url)}" target="_blank" rel="noopener">원문 →</a>` : '';
        return `<div class="citem" data-kind="${esc(e.kind)}">
        <span class="ctag" style="color:${col};background:${bg}">${lab}</span>
        <div class="cbody"><a class="cnm" href="../r/${esc(e.ticker)}/">${esc(e.name)}</a><span class="ctx">${esc(e.text)}</span>${ext}</div>
      </div>`;
      }).join('')}
    </div>`).join('');
  const body = `  <p class="crumb"><a href="../">홈</a> › 최근 변화</p>
  <span class="eyebrow">변화 감지 · 사실만 기록</span>
  <h1>최근 30일, 무엇이 변했나</h1>
  <p class="lead">52주 신저가 · 하루 ±4% 급등락 · P/NAV 구간 이동 · 주요 공시를 자동 수집해 기록합니다. 해석과 추천 없이 <b>사실</b>만 남기며, 종목명을 누르면 상세 페이지로 이동합니다.</p>
  <div class="fbar"><button class="fchip on" type="button" data-kind="">전체</button>${chip('low', '52주 신저가')}${chip('move', '급등락')}${chip('pnav', 'P/NAV 이동')}${chip('div', '배당 공시')}${chip('filing', '공시')}</div>
  ${events.length ? groups : '<div class="card"><p class="muted">최근 30일 기록이 아직 없습니다. 매일 자동 수집 후 이 페이지에 쌓입니다.</p></div>'}
  <div class="card">
    <h2>이 로그는 어떻게 만들어지나</h2>
    <p class="small muted" style="margin:0">매일 시세·공시 수집 후 직전 스냅샷과 비교해 변화만 기록합니다(최근 30일 · 최대 60건 보관). 기준: 52주 최저가의 0.2% 이내 진입, 하루 ±4% 이상 변동, P/NAV 0.1배 구간 이동, 최근 7일 주요 공시. 자세한 산정 방식은 <a class="more" href="../about/">데이터 방법론</a>에 있습니다.</p>
  </div>`;
  const shell = landingShell({ title, desc, canonical: url, rel: '../', ld, body });
  const extra = `<style>
.fbar{display:flex;flex-wrap:wrap;gap:7px;margin:14px 0 4px}
.fchip{font:inherit;font-size:12.5px;font-weight:800;color:var(--muted);background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:7px 13px;cursor:pointer}
.fchip.on{color:#fff;background:var(--brand);border-color:var(--brand)}
.dgroup{margin-top:16px}
.dhead{font-size:12.5px;font-weight:800;color:var(--muted);margin:0 2px 8px}
.citem{display:flex;gap:10px;align-items:flex-start;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:11px 13px;margin-top:7px}
.ctag{flex:none;font-size:10.5px;font-weight:800;border-radius:999px;padding:3px 9px;margin-top:1px;white-space:nowrap}
.cbody{font-size:13.5px;line-height:1.5}
.cnm{font-weight:800;color:var(--text);text-decoration:none}
.cnm:hover{color:var(--brand)}
.ctx{color:var(--muted);margin-left:6px}
.dartl{color:var(--brand);text-decoration:none;font-weight:700;font-size:12px;margin-left:6px;white-space:nowrap}
</style>
<script>
(function(){
  var chips=[].slice.call(document.querySelectorAll('.fchip'));
  chips.forEach(function(c){ c.addEventListener('click', function(){
    chips.forEach(function(x){ x.classList.toggle('on', x===c); });
    var k=c.getAttribute('data-kind');
    [].slice.call(document.querySelectorAll('.citem')).forEach(function(it){ it.style.display=(!k||it.getAttribute('data-kind')===k)?'':'none'; });
    [].slice.call(document.querySelectorAll('.dgroup')).forEach(function(g){
      var vis=[].slice.call(g.querySelectorAll('.citem')).some(function(it){ return it.style.display!=='none'; });
      g.style.display=vis?'':'none';
    });
  }); });
})();
</script>
</body>`;
  return shell.replace('</body>', extra);
}

// ---- 404 페이지: GitHub Pages는 404.html을 모든 미존재 경로에 서빙. 절대경로 링크로 복귀 유도 ----
function notFoundPage() {
  const title = '페이지를 찾을 수 없습니다 | 리츠온 REITs ON';
  const sectorChips = Object.entries(SECTOR_META).map(([k, m]) => `<a href="${BASE}/s/${m.slug}/">${k} 리츠</a>`).join('');
  const stockChips = REITS.slice().sort((a, b) => a.name.localeCompare(b.name, 'ko')).map((r) => `<a href="${BASE}/r/${r.ticker}/">${esc(r.name)}</a>`).join('');
  const ld = { '@context': 'https://schema.org', '@type': 'WebPage', name: title, inLanguage: 'ko' };
  const body = `  <span class="eyebrow">404</span>
  <h1>페이지를 찾을 수 없습니다</h1>
  <p class="lead">주소가 바뀌었거나 잘못 입력됐을 수 있어요. 아래에서 찾으시던 곳으로 바로 이동하세요.</p>
  <div class="card">
    <h2>자주 찾는 곳</h2>
    <div class="chips"><a href="${BASE}/">홈</a><a href="${BASE}/facts.html">📊 팩트시트</a><a href="${BASE}/changes/">최근 변화</a><a href="${BASE}/about/">사이트 소개·방법론</a></div>
  </div>
  <div class="card"><h2>섹터별 리츠</h2><div class="chips">${sectorChips}</div></div>
  <div class="card"><h2>종목 바로가기</h2><div class="chips">${stockChips}<a href="${BASE}/r/088980/">맥쿼리인프라</a></div></div>`;
  const shell = landingShell({ title, desc: '요청하신 페이지를 찾을 수 없습니다. 리츠온 홈·팩트시트·섹터·종목 페이지로 이동하세요.', canonical: BASE + '/', rel: BASE + '/', ld, body });
  return shell.replace('</head>', '<meta name="robots" content="noindex" />\n</head>');
}

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
// 인프라펀드 페이지(별도 템플릿)
let infraCount = 0;
for (const x of INFRA) {
  const dir = join(rDir, x.ticker);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), infraPage(x), 'utf8');
  infraCount++;
}

// ---- 팩트시트 페이지 ----
writeFileSync(join(ROOT, 'facts.html'), factsPage(), 'utf8');

// ---- 신뢰·방법론(/about/) ----
const aboutDir = join(ROOT, 'about');
mkdirSync(aboutDir, { recursive: true });
writeFileSync(join(aboutDir, 'index.html'), aboutPage(), 'utf8');

// ---- 최근 변화(/changes/) + 404 ----
const changesDir = join(ROOT, 'changes');
mkdirSync(changesDir, { recursive: true });
writeFileSync(join(changesDir, 'index.html'), changesPage(), 'utf8');
writeFileSync(join(ROOT, '404.html'), notFoundPage(), 'utf8');

// ---- 섹터 랜딩(/s/{slug}/) ----
const sDir = join(ROOT, 's');
if (existsSync(sDir)) { for (const d of readdirSync(sDir)) rmSync(join(sDir, d), { recursive: true, force: true }); }
const byPrimary = {};
for (const r of REITS) { (byPrimary[r.primary] = byPrimary[r.primary] || []).push(r); }
let sectorCount = 0;
const sectorUrls = [];
for (const [name, meta] of Object.entries(SECTOR_META)) {
  const list = byPrimary[name] || [];
  if (!list.length) continue;
  const dir = join(sDir, meta.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), sectorPage(name, meta, list), 'utf8');
  sectorUrls.push(BASE + '/s/' + meta.slug + '/');
  sectorCount++;
}

// ---- sitemap ----
const today = new Date().toISOString().slice(0, 10);
const urls = [BASE + '/', BASE + '/about/', BASE + '/changes/', BASE + '/facts.html']
  .concat(sectorUrls)
  .concat(REITS.map(r => BASE + '/r/' + r.ticker + '/'))
  .concat(INFRA.map(x => BASE + '/r/' + x.ticker + '/'));
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls.map(u => `  <url>\n    <loc>${u}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>${u.endsWith('/reits-on/') ? '1.0' : '0.7'}</priority>\n  </url>`).join('\n') +
  `\n</urlset>\n`;
writeFileSync(join(ROOT, 'sitemap.xml'), sitemap, 'utf8');

console.log(`생성 완료: 종목 ${count}개 + 인프라 ${infraCount}개 + 섹터 ${sectorCount}개 + about + facts.html + sitemap(${urls.length} URL)`);
