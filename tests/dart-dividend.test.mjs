import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseDividendDoc, parseDcmNo, docTextSeq, DIV_DECISION_RE } from '../scripts/lib/dart-dividend.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const doc = readFileSync(join(FIX, 'dart-div-448730.html'), 'utf8');
const main = readFileSync(join(FIX, 'dart-main-448730.html'), 'utf8');

test('실제 공시(삼성FN 금전배당결정) 파싱: 주당액·기준일·총액·주총일', () => {
  const d = parseDividendDoc(doc);
  assert.ok(d, '파싱 결과가 null');
  assert.equal(d.perShare, 69);                 // 1주당 배당금 69원(보통주식)
  assert.equal(d.recordDate, '2026-04-30');     // 배당기준일
  assert.equal(d.totalWon, 6253000000);         // 배당금총액
  assert.equal(d.yieldPct, 1.0);                // 시가배당률
  assert.equal(d.agmDate, '2026-07-24');        // 주주총회 예정일
  assert.equal(d.decidedAt, '2026-07-07');      // 이사회결의일
  assert.equal(d.payDate, null);                // 지급일이 날짜가 아니라 텍스트
  assert.match(d.payText, /주주총회일로부터/);
});

test('main.do에서 dcmNo 추출', () => {
  assert.equal(parseDcmNo(main, '20260707800460'), '11466631');
});

test('필수 필드 없으면 null (지어내지 않음)', () => {
  assert.equal(parseDividendDoc('<html><body>배당 없음</body></html>'), null);
  assert.equal(parseDividendDoc('<td>1주당 배당금(원)</td><td>-</td>'), null); // 금액 없음
});

test('지급예정일이 실제 날짜인 변형도 파싱', () => {
  const html = '<td>2. 1주당 배당금(원)</td><td>보통주식</td><td>150</td>'
    + '<td>4. 배당기준일</td><td>2026-06-30</td>'
    + '<td>5. 배당금지급 예정일</td><td>2026-08-14</td>';
  const d = parseDividendDoc(html);
  assert.equal(d.perShare, 150);
  assert.equal(d.recordDate, '2026-06-30');
  assert.equal(d.payDate, '2026-08-14');
  assert.equal(d.payText, null);
});

test('날짜 표기 변형(2026.04.30 / 2026년 4월 30일) 정규화', () => {
  const mk = (dt) => `<td>1주당 배당금</td><td>보통주식</td><td>100</td><td>배당기준일</td><td>${dt}</td>`;
  assert.equal(parseDividendDoc(mk('2026.04.30')).recordDate, '2026-04-30');
  assert.equal(parseDividendDoc(mk('2026년 4월 30일')).recordDate, '2026-04-30');
});

test('배당결정 제목 판별 정규식', () => {
  assert.ok(DIV_DECISION_RE.test('부동산투자회사금전배당결정'.replace(/금전배당결정/, '금전배당 결정')));
  assert.ok(DIV_DECISION_RE.test('부동산투자회사 금전배당 결정'));
  assert.ok(DIV_DECISION_RE.test('현금ㆍ현물배당 결정'));
  assert.ok(!DIV_DECISION_RE.test('주주총회소집결의'));
  assert.ok(!DIV_DECISION_RE.test('부동산투자회사부동산임대'));
});

test('docTextSeq: 태그 제거·공백 정리', () => {
  const seq = docTextSeq('<table><tr><td> 가 나 </td><td>다</td></tr></table>');
  assert.deepEqual(seq, ['가 나', '다']);
});
