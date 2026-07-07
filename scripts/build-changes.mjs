// 변화감지 엔진: 직전 스냅샷 대비 '무엇이 변했나'를 사실만으로 기록한다(추천·해석 배제).
// 감지: 52주 신저가 · 급등락(±4%↑) · P/NAV 밴드 이동 · 주요 공시(최근 7일).
// 출력: data/changes.json(최근 이벤트 로그) + data/snapshot.json(현재 상태 저장).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computePnav } from './lib/nav.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dp = (p) => join(ROOT, 'data', p);
const readJSON = (p, f) => { try { return JSON.parse(readFileSync(dp(p), 'utf8')); } catch { return f; } };
const NOW = new Date().toISOString();
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const daysAgo = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - n); return t.toISOString().slice(0, 10); };

const reitsDoc = readJSON('reits.json', { reits: [] });
const filingsDoc = readJSON('filings.json', { filings: [] });
const snap = readJSON('snapshot.json', { reits: {} });
const prev = snap.reits || {};

const pnavBand = (v) => v == null ? null : v < 0.6 ? '0.6배 미만' : v < 0.7 ? '0.6~0.7배' : v < 0.8 ? '0.7~0.8배' : v < 0.9 ? '0.8~0.9배' : v < 1.0 ? '0.9~1.0배' : '1.0배 이상';

const events = [];
const nextSnap = { date: TODAY, reits: {} };

for (const r of reitsDoc.reits) {
  const m = r.market || {};
  const price = typeof m.price === 'number' ? m.price : null;
  const pnav = (() => { const pn = computePnav(r, price); return pn ? pn.pnav : null; })();
  const band = pnavBand(pnav);
  const p = prev[r.ticker] || {};
  nextSnap.reits[r.ticker] = { price, low: m.week52Low ?? null, band, atLow: (price != null && m.week52Low != null && price <= m.week52Low * 1.002) };

  if (price == null) continue;
  const nm = r.name;
  // 52주 신저가: 오늘 처음 최저가 부근 진입(직전엔 아니었을 때만)
  if (m.week52Low != null && price <= m.week52Low * 1.002 && !p.atLow) {
    events.push({ date: m.priceAsOf || TODAY, ticker: r.ticker, name: nm, kind: 'low', text: `52주 최저가 부근 ${price.toLocaleString('ko-KR')}원` });
  }
  // 급등락(하루 ±4% 이상)
  if (typeof m.changePct === 'number' && Math.abs(m.changePct) >= 4) {
    events.push({ date: m.priceAsOf || TODAY, ticker: r.ticker, name: nm, kind: 'move', text: `하루 ${m.changePct > 0 ? '+' : ''}${m.changePct}% ${m.changePct > 0 ? '상승' : '하락'} (${price.toLocaleString('ko-KR')}원)` });
  }
  // P/NAV 밴드 이동
  if (band && p.band && band !== p.band) {
    events.push({ date: TODAY, ticker: r.ticker, name: nm, kind: 'pnav', text: `P/NAV 구간 이동 ${p.band} → ${band}` });
  }
}

// 주요 공시(최근 7일) — filings.json(이미 소음 제거됨)
const nameByT = {}; reitsDoc.reits.forEach((r) => { nameByT[r.ticker] = r.name; });
const since = daysAgo(TODAY, 7);
for (const f of (filingsDoc.filings || [])) {
  if (!f.filed_at || f.filed_at < since) continue;
  const isDiv = /배당|분배금/.test(f.title || '');
  events.push({ date: f.filed_at, ticker: f.ticker, name: nameByT[f.ticker] || f.ticker, kind: isDiv ? 'div' : 'filing', text: (isDiv ? '배당 관련 공시: ' : '공시: ') + String(f.title).replace(/\s+/g, ' ').trim(), url: f.url });
}

// 최신순 정렬, 최근 30일·최대 60건 보관. 기존 로그와 병합(중복 제거: date+ticker+text)
const old = readJSON('changes.json', { events: [] }).events || [];
const key = (e) => e.date + '|' + e.ticker + '|' + String(e.text).replace(/\s+/g, ' ').trim();
const seen = new Set();
const merged = [...events, ...old]
  .filter((e) => e.date >= daysAgo(TODAY, 30))
  .filter((e) => { const k = key(e); if (seen.has(k)) return false; seen.add(k); return true; })
  .sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0)
  .slice(0, 60);

writeFileSync(dp('changes.json'), JSON.stringify({ retrievedAt: NOW, events: merged }) + '\n', 'utf8');
writeFileSync(dp('snapshot.json'), JSON.stringify(nextSnap) + '\n', 'utf8');
console.log(`변화감지: 신규 이벤트 ${events.length}건 · 누적 ${merged.length}건(최근 30일)`);
