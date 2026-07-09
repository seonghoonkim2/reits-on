// 배당 캘린더 .ics 구독 피드(사이트 전역 1개). 서버 없이 캘린더 앱이 알림을 대신 보내주는 유일한 푸시 채널.
// 예상(결산월 말일 가정) 연반복 이벤트 + DART 배당결정 공시에서 무키 파싱한 '확정' 단발 이벤트를 함께 담는다.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computeTtmDps } from './lib/ttm-dividend.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://seonghoonkim2.github.io/reits-on';
const reits = JSON.parse(readFileSync(join(ROOT, 'data', 'reits.json'), 'utf8')).reits;
const NAME_BY_TICKER = Object.fromEntries(reits.map((r) => [r.ticker, r.name]));
let CONFIRMED = [];
try { CONFIRMED = (JSON.parse(readFileSync(join(ROOT, 'data', 'dividends-confirmed.json'), 'utf8')).confirmed) || []; } catch { /* 최초 */ }

const pad = (n) => String(n).padStart(2, '0');
const YEAR = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric' }).format(new Date()));
const lastDay = (y, m) => new Date(y, m, 0).getDate();      // m: 1~12
// DTSTAMP(now, UTC) — 스크립트는 Date 사용 가능
const dtstamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
// ICS 텍스트 이스케이프
const esc = (s) => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
// 75옥텟 폴딩(간이): 긴 라인을 접는다
const fold = (line) => line.length <= 74 ? line : line.match(/.{1,73}/g).join('\r\n ');

const events = [];
for (const r of reits) {
  if (!Array.isArray(r.divMonths) || !r.divMonths.length) continue;
  const ttm = computeTtmDps(r);
  const freq = Math.max(1, r.divMonths.length);
  const perEst = (ttm.ttmDps != null && ttm.ttmDps > 0) ? Math.round(ttm.ttmDps / freq) : null;
  const amt = perEst ? ` · 예상 주당배당 약 ${perEst.toLocaleString('ko-KR')}원(1회, 최근 실적 기준)` : '';
  for (const m of r.divMonths) {
    const d = `${YEAR}${pad(m)}${pad(lastDay(YEAR, m))}`;
    events.push([
      'BEGIN:VEVENT',
      `UID:reiton-${r.ticker}-${pad(m)}@reits-on`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${d}`,
      'RRULE:FREQ=YEARLY',
      'TRANSP:TRANSPARENT',
      fold(`SUMMARY:${esc('[' + r.name + '] 배당기준월(예상)')}`),
      fold(`DESCRIPTION:${esc(`예상 배당기준월입니다(결산월 말일 가정 · 확정 아님). 실제 기준일·지급일은 DART 공시로 확인하세요.${amt}\n${BASE}/r/${r.ticker}/`)}`),
      `URL:${BASE}/r/${r.ticker}/`,
      'END:VEVENT',
    ].join('\r\n'));
  }
}

// 확정 배당 단발 이벤트(공시 파싱): 지급일이 날짜로 확정되면 그 날, 아니면 주총 예정일에 안내.
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
let confirmedCount = 0;
for (const c of CONFIRMED) {
  const nm = NAME_BY_TICKER[c.ticker] || c.ticker;
  const amt = c.perShare ? `주당 ${Number(c.perShare).toLocaleString('ko-KR')}원` : '';
  const mk = (dateISO, summary, desc) => {
    const d = dateISO.replace(/-/g, '');
    events.push([
      'BEGIN:VEVENT',
      `UID:reiton-conf-${c.rcpNo}-${d}@reits-on`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${d}`,
      'TRANSP:TRANSPARENT',
      fold(`SUMMARY:${esc(summary)}`),
      fold(`DESCRIPTION:${esc(`${desc}\n공시 원문: ${c.url}\n${BASE}/r/${c.ticker}/`)}`),
      `URL:${BASE}/r/${c.ticker}/`,
      'END:VEVENT',
    ].join('\r\n'));
    confirmedCount++;
  };
  if (c.payDate && c.payDate >= TODAY) {
    mk(c.payDate, `[${nm}] 배당 지급(확정) ${amt}`, `배당결정 공시 기준 확정 지급일입니다. 기준일 ${c.recordDate}.`);
  } else if (c.agmDate && c.agmDate >= TODAY) {
    mk(c.agmDate, `[${nm}] 주주총회 — 배당 확정 ${amt}`, `배당결정 공시: ${amt} · 기준일 ${c.recordDate} · 지급 ${c.payText || '주주총회 이후'}.`);
  }
}

const ics = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//reits-on//dividend-calendar//KO',
  'CALSCALE:GREGORIAN',
  'METHOD:PUBLISH',
  'X-WR-CALNAME:리츠온 배당 캘린더',
  'X-WR-CALDESC:국내 상장리츠 배당기준월(예상 연반복) + 공시 확정 배당(단발). 교육용·투자권유 아님.',
  'X-WR-TIMEZONE:Asia/Seoul',
  ...events,
  'END:VCALENDAR',
].join('\r\n') + '\r\n';

writeFileSync(join(ROOT, 'reits-on.ics'), ics, 'utf8');
console.log(`reits-on.ics 생성: 이벤트 ${events.length}건(예상 연반복 ${events.length - confirmedCount} + 확정 ${confirmedCount})`);
