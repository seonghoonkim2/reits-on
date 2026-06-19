# IMPLEMENTATION_PLAN.md (2026-06-19)

## 완료(P0/P1, 배포됨)
| 항목 | 파일 | 완료기준 |
|---|---|---|
| 표현 정합(추천/배당기준월/입력가/안전성 라벨) | index.html | 잔여 플래그 0 |
| provenance 데이터 모델 + data/*.json | data/, schema/, scripts/{extract,embed,validate} | validate 통과, 임베드 byte 동일 |
| 상세 ‘핵심 팩트’(출처·기준일·상태, 미확보=자료확인필요) | index.html(#detailFacts) | 25종목 렌더, 날조 0 |
| 금융계산 모듈화+테스트 | assets/js/finance.mjs, scripts/build-app.mjs, tests/ | 8/8 통과, 동작 불변 |
| 종목 SEO 정적페이지+sitemap+cron | scripts/build-pages.mjs, .github/workflows | 25페이지 200 |
| 접근성 critical/serious 0 | index.html(CSS) | axe light/dark clean |
| CI 게이트 | .github/workflows/build-pages.yml | test→validate→embed→build-app→build-pages |

## P1 (다음, 저위험)
- Chart.js 월별 배당 차트(현 stacked-bar 대체) — lazy/dynamic import, 표·CSV 유지, IntersectionObserver. 노력 1~2d.
- 정성팩트 입력: data/reits.json의 facts에 실제 LTV/WALE/임차인 입력(운용 실무자) → 검증·점등. 노력: 데이터 작업.
- 브라우저 E2E 15종 + 성능 계측. 노력 1~2d.
- 자산군 분포 Chart.js 도넛(계층 데이터 없으므로 treemap 보류). 노력 0.5d.
- 모듈 추가 분리(router/store/detail 등)는 점진적. 전면 분리는 비권장.

## P2 (설계·승인 필요 — RFC 참조)
- 가격 데이터(라이선스) 연동 — DATA_ARCHITECTURE §2 B계층.
- LLM 공시 요약 — LLM_RFC.md (외부 LLM 호출 승인 필요).
- MILP 시나리오 — SCENARIO_ENGINE_RFC.md (휴리스틱 우선, glpk.js는 옵션).
- BaaS 동기화 — 개인정보 고지 모드 분리 + 동의(법률 검토).

## 의존성/승인 필요(중대 변경)
- 가격 데이터 라이선스/비용, 외부 LLM API, BaaS(개인정보 전송), 개인정보 고지 변경, GitHub Pages 배포방식 변경.
