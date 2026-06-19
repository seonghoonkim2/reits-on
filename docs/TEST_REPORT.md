# TEST_REPORT.md (2026-06-19)

## 통과(자동)
- **금융계산 단위테스트** `node --test tests/finance.test.mjs` — 8/8 통과
  (clampNum 가드, annualizedDps, afterTaxNet 세율가드, returnYieldPct, perMonthContribution, neededCapital, impliedPrice, 세전/세후 회귀)
- **데이터 검증** `node scripts/validate.mjs` — 25종목 오류 0(provenance status·actual은 value·출처 필수·unavailable은 null).
- **빌드 파이프라인** validate→embed→build-app→build-pages 로컬 PASS, 임베드 seed byte 동일(런타임 불변) 확인.
- **JS 구문/중복 ID** — index.html 스크립트 파싱 OK, 중복 id 없음.
- **접근성(axe-core 4.10, WCAG 2.1 A/AA)** — home/find/income/learn/detail × {light,dark} 모두 **critical·serious 0**.
  - 수정: nested-interactive(카드 role=button→이름 버튼), color-contrast(작은 칩 잉크·다크 브랜드 텍스트 --on-brand), link-in-text-block(출처 링크 underline), 탭 텍스트(다크 토픽바 대비).

## 통과(수동/시각 — Playwright 스크린샷)
- 인컴 조합예시 생성: 12/12개월·월평균 52,506원·6.3%(리팩터 전후 동일).
- 빠른 계산기: 세후연 630,700·월 52,558·필요투자금 95,132,393(동일).
- 상세 ‘핵심 팩트’: AUM=7,217억(2025-12-31·출처·실측), LTV/WALE 등=‘자료 확인 필요·미확보’.
- 종목 SEO 페이지 `/r/<ticker>/` 200·고유 title.

## 미실행(권장 — IMPLEMENTATION_PLAN P1/P2)
- 브라우저 E2E 시나리오 15종(딥링크 #~t=, 뒤로가기, CSV, localStorage 손상 등) 자동화.
- 시각 회귀(스냅샷) 테스트.
- 성능 계측(LCP/CLS/INP) 전후 비교.
- 가격·LLM·BaaS·MILP PoC(승인 후).

## 알려진 한계
- 시세 미연동(입력가 기준 추정 유지). LTV/WALE 등 정성팩트 미확보(스키마·검증 준비됨, 사람이 data/reits.json 입력 필요).
- 푸시 ‘전송’은 Worker 배포 후에만 검증 가능.
