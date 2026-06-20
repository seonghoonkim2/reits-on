// 데이터 보강 체크리스트 생성기.
// data/reits.json의 정성팩트를 점검해 (1) 미확보(unavailable) 항목과
// (2) 기준일(asOf)이 오래된(stale) 항목을 Markdown 리포트로 출력한다.
// 값을 만들어내지 않는다 — 사람이 원문(DART/IR)을 확인해 보강하도록 '할 일'만 모은다.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STALE_DAYS = Number(process.env.STALE_DAYS || 270); // 반기 공시 주기(≈183일) 1주기 경과+버퍼

const doc = JSON.parse(readFileSync(join(ROOT, 'data', 'reits.json'), 'utf8'));
const LABELS = {
  ltv: 'LTV', wale: 'WALE', occupancy: '임대율/공실', debtFixedRatio: '고정금리비중',
  debtMaturity12m: '12개월내만기', topTenant: '주요임차인', tenantConcentration: '임차인집중도',
};
const KEYS = Object.keys(LABELS);
const today = new Date();
const daysSince = (d) => d ? Math.floor((today - new Date(d)) / 86400000) : Infinity;

let totalActual = 0;
const missingByReit = [];
const staleRows = [];

for (const r of doc.reits) {
  const missing = [];
  for (const k of KEYS) {
    const p = r.facts[k] || {};
    if (p.status === 'actual') {
      totalActual++;
      const age = daysSince(p.asOf);
      if (age > STALE_DAYS) staleRows.push(`- \`${r.ticker}\` ${r.name} · **${LABELS[k]}** — 기준일 ${p.asOf} (${age}일 경과)`);
    } else {
      missing.push(LABELS[k]);
    }
  }
  if (missing.length) missingByReit.push(`- \`${r.ticker}\` ${r.name} (${missing.length}건): ${missing.join(', ')}`);
}

const total = doc.reits.length * KEYS.length;
const irCount = doc.reits.filter((r) => r.irResources && r.irResources.irPage).length;
const stamp = today.toISOString().slice(0, 10);

const md = `# 📊 리츠 데이터 보강 체크리스트 (자동 생성)

- 생성일: ${stamp}
- 정성팩트 실측: **${totalActual} / ${total}**
- IR 자료 링크: **${irCount} / ${doc.reits.length}** 종목
- 갱신 필요(stale, 기준일 ${STALE_DAYS}일 초과): **${staleRows.length}건**

> 이 문서는 자동 점검 결과입니다. 값을 추정/생성하지 않으며, 아래 항목은 DART·각 리츠 투자보고서/IR 원문을 확인해 \`data/reits.json\`에 \`status:actual\`로 보강해야 할 후보입니다.

## 🟡 갱신 필요 (기준일 경과)
${staleRows.length ? staleRows.join('\n') : '- 없음'}

## 🔴 미확보 항목 (unavailable)
${missingByReit.length ? missingByReit.join('\n') : '- 없음 (전 종목 완비)'}
`;

mkdirSync(join(ROOT, 'docs'), { recursive: true });
writeFileSync(join(ROOT, 'docs', 'data-freshness.md'), md, 'utf8');
process.stdout.write(md);
console.error(`\n[freshness] 실측 ${totalActual}/${total} · stale ${staleRows.length} · 미확보종목 ${missingByReit.length}`);
