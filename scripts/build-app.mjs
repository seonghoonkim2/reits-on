// assets/js/finance.mjs(순수 함수, 테스트됨)를 index.html의 FINANCE_INLINE 블록에 주입.
// 브라우저는 classic script를 유지(파일 프로토콜·기존 구조 호환). export만 제거해 인라인화.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// 순수 모듈을 인라인화: export 제거(import 라인도 제거 — 인라인 후엔 같은 스코프에 존재), 들여쓰기 정렬
const inline = (relPath) => readFileSync(join(ROOT, relPath), 'utf8')
  .replace(/^\s*import[^\n]*\n/gm, '')          // import 문 제거(인라인 스코프 공유)
  .replace(/^export\s+/gm, '')                  // export 제거
  .split('\n').map((l) => l.length ? '    ' + l : l).join('\n');

let html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const injectBlock = (marker, code) => {
  const re = new RegExp(`(// ${marker}_START[^\\n]*\\n)([\\s\\S]*?)([ \\t]*// ${marker}_END)`);
  if (!re.test(html)) { console.error(`${marker} 마커 없음`); process.exit(1); }
  html = html.replace(re, `$1${code.replace(/\n+$/, '')}\n    $3`);
};
injectBlock('FINANCE_INLINE', inline(join('assets', 'js', 'finance.mjs')));
injectBlock('METRICS_INLINE', inline(join('assets', 'js', 'reit-metrics.mjs')));
writeFileSync(join(ROOT, 'index.html'), html, 'utf8');
console.log('finance.mjs + reit-metrics.mjs → index.html 주입 완료');
