// 시세 표시용 순수 헬퍼(빌드 타임). 네트워크·DOM 없음 → 단위 테스트 가능.
// week52Position은 런타임과 공유(브라우저·빌드 공용 모듈에서 재노출).
export { week52Position } from '../../assets/js/reit-metrics.mjs';

// 일별 종가 시계열 → 인라인 SVG 스파크라인 문자열. series=[{d,c}] (오래된→최근).
// 빌드 시 종목 페이지에 임베드(런타임 fetch 없음). 최대 maxPoints로 다운샘플.
export function sparklineSvg(series, opts = {}) {
  const { w = 240, h = 44, pad = 3, maxPoints = 64, up = '#d1453b', down = '#1f6feb', flat = '#888' } = opts;
  const pts = (Array.isArray(series) ? series : []).map((p) => (p && typeof p.c === 'number' ? p.c : null)).filter((c) => c != null && c > 0);
  if (pts.length < 2) return '';
  // 균등 다운샘플
  let vals = pts;
  if (pts.length > maxPoints) {
    vals = [];
    const step = (pts.length - 1) / (maxPoints - 1);
    for (let i = 0; i < maxPoints; i++) vals.push(pts[Math.round(i * step)]);
  }
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const innerW = w - pad * 2, innerH = h - pad * 2;
  const coords = vals.map((v, i) => {
    const x = pad + (i / (vals.length - 1)) * innerW;
    const y = pad + (1 - (v - min) / span) * innerH;
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  });
  const color = vals[vals.length - 1] > vals[0] ? up : vals[vals.length - 1] < vals[0] ? down : flat;
  const line = coords.map(([x, y]) => `${x},${y}`).join(' ');
  const area = `${pad},${h - pad} ${line} ${w - pad},${h - pad}`;
  const gid = `sg${Math.abs(hashStr(line)) % 100000}`;   // 그라디언트 id 충돌 회피(결정적)
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none" role="img" aria-label="최근 1년 주가 추이">`
    + `<defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1">`
    + `<stop offset="0" stop-color="${color}" stop-opacity="0.18"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>`
    + `<polygon points="${area}" fill="url(#${gid})"/>`
    + `<polyline points="${line}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`
    + `</svg>`;
}

// 결정적 문자열 해시(Math.random 없이 고유 id 생성용)
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return h;
}
