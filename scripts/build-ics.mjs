// 배당 캘린더 .ics 구독 피드(사이트 전역 1개). 서버 없이 캘린더 앱이 알림을 대신 보내주는 유일한 푸시 채널.
// ⚠ 확정 배당기준일이 아직 없으므로 '예상(결산월 말일 가정)'으로만 표기한다(확정 파싱은 후속 턴).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computeTtmDps } from './lib/ttm-dividend.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://seonghoonkim2.github.io/reits-on';
const reits = JSON.parse(readFileSync(join(ROOT, 'data', 'reits.json'), 'utf8')).reits;

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

const ics = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//reits-on//dividend-calendar//KO',
  'CALSCALE:GREGORIAN',
  'METHOD:PUBLISH',
  'X-WR-CALNAME:리츠온 배당 캘린더(예상)',
  'X-WR-CALDESC:국내 상장리츠 배당기준월(예상). 교육용·투자권유 아님. 실제 기준일은 공시 확인.',
  'X-WR-TIMEZONE:Asia/Seoul',
  ...events,
  'END:VCALENDAR',
].join('\r\n') + '\r\n';

writeFileSync(join(ROOT, 'reits-on.ics'), ics, 'utf8');
console.log(`reits-on.ics 생성: 이벤트 ${events.length}건(연 반복)`);
