// node --test tests/price-display.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { week52Position, sparklineSvg } from '../scripts/lib/price-display.mjs';

test('week52Position: 위치·저점대비·고점대비', () => {
  const p = week52Position(3360, 3230, 4795);
  assert.equal(p.posPct, 8);            // (3360-3230)/(4795-3230)
  assert.equal(p.fromLowPct, 4);        // (3360-3230)/3230*100 ≈ 4.0
  assert.equal(p.offHighPct, 29.9);     // (4795-3360)/4795*100 = 고점 대비 하락률(% below high)
});

test('week52Position: 가드(0·역전·결측)', () => {
  assert.equal(week52Position(3360, 0, 4795), null);
  assert.equal(week52Position(3360, 4795, 3230), null);   // high<=low
  assert.equal(week52Position(null, 100, 200), null);
});

test('week52Position: 밴드 밖 클램프', () => {
  assert.equal(week52Position(5000, 3230, 4795).posPct, 100); // 고점 초과 → 100
  assert.equal(week52Position(3000, 3230, 4795).posPct, 0);   // 저점 미만 → 0
});

test('sparklineSvg: 유효 SVG + 다운샘플', () => {
  const series = Array.from({ length: 300 }, (_, i) => ({ d: '2026-01-01', c: 1000 + i }));
  const svg = sparklineSvg(series, { maxPoints: 64 });
  assert.match(svg, /^<svg[\s\S]*<\/svg>$/);
  assert.match(svg, /<polyline /);
  // 64개로 다운샘플 → polyline 좌표쌍 64개
  const pts = svg.match(/points="([^"]*)"/g)[1];   // polyline points
  assert.equal(pts.split(' ').length, 64);
});

test('sparklineSvg: 상승=빨강 / 하락=파랑', () => {
  const up = sparklineSvg([{ c: 100 }, { c: 200 }]);
  assert.match(up, /#d1453b/);
  const down = sparklineSvg([{ c: 200 }, { c: 100 }]);
  assert.match(down, /#1f6feb/);
});

test('sparklineSvg: 데이터 부족 → 빈 문자열', () => {
  assert.equal(sparklineSvg([]), '');
  assert.equal(sparklineSvg([{ c: 100 }]), '');
  assert.equal(sparklineSvg(null), '');
});
