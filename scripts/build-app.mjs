// assets/js/finance.mjs(순수 함수, 테스트됨)를 index.html의 FINANCE_INLINE 블록에 주입.
// 브라우저는 classic script를 유지(파일 프로토콜·기존 구조 호환). export만 제거해 인라인화.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fin = readFileSync(join(ROOT, 'assets', 'js', 'finance.mjs'), 'utf8')
  .replace(/^export\s+/gm, '')                 // export 제거 → 인라인 const/function
  .split('\n').map((l) => l.length ? '    ' + l : l).join('\n');  // 들여쓰기 정렬

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const re = /(\/\/ FINANCE_INLINE_START[^\n]*\n)([\s\S]*?)(\n[ \t]*\/\/ FINANCE_INLINE_END)/;
if (!re.test(html)) { console.error('FINANCE_INLINE 마커 없음'); process.exit(1); }
const block = '\n' + fin.replace(/\n+$/, '') + '\n';
const out = html.replace(re, `$1${block}$3`);
writeFileSync(join(ROOT, 'index.html'), out, 'utf8');
console.log('finance.mjs → index.html 주입 완료');
