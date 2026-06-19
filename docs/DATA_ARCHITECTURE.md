# DATA_ARCHITECTURE.md

리츠온 데이터 아키텍처 (2026-06-19 기준)

## 1. 원칙
- 확인되지 않은 숫자를 생성하지 않는다. 없으면 `null` + `status:"unavailable"` + UI "자료 확인 필요".
- 모든 핵심 수치는 provenance(값·단위·기준일·상태·출처)를 갖는다.
- 서로 다른 기준일(asOf)의 수치를 같은 시점처럼 비교/합산하지 않는다.
- 실제값(actual)·추정(estimated)·연환산(annualized)·사용자입력(user_input)·갱신지연(stale)·미확보(unavailable)를 구분한다.

## 2. 소스 3계층
| 계층 | 내용 | 원천 | 상태 |
|---|---|---|---|
| A. 공시·재무·기업메타 | 공시 목록·재무·기업정보 | DART OpenAPI, KIND, 국토부 리츠정보시스템, IR | **DART 공시 자동수집 가동**(Worker cron), 나머지 수동 |
| B. 가격·거래·배당락 | 종가·시총·거래량·배당락 | data.go.kr(금융위 EOD) 또는 라이선스 공급자 | **미연동**(키 대기). 무단 크롤링 금지 |
| C. 수동 보정·도메인 메타 | 자산군·임차인·LTV·WALE·해외여부 등 정성 | 투자보고서·IR(사람이 입력) | `data/reits.json`의 `facts`로 관리 |

가격(B)이 없으면 사용자 입력 방식 유지(“현재가를 입력해 예상 수익률 계산”).

## 3. 정규화 스키마 (provenance 객체)
```json
{
  "value": 52.1, "unit": "%", "display": null,
  "asOf": "2025-12-31", "status": "actual",
  "sourceUrl": "https://dart.fss.or.kr/...", "sourceId": "dart-20260319000123",
  "note": null
}
```
`status` ∈ { actual, estimated, annualized, user_input, stale, unavailable }

규칙(scripts/validate.mjs에서 강제):
- status가 actual/estimated/annualized → `value != null` & (`sourceUrl` 또는 `sourceId`) 필수, `asOf` 권장.
- status가 unavailable → `value == null` (0 표시 금지).

## 4. 파일 레이아웃 (현재)
```
data/
  reits.json     # 단일 진실원천: 종목 기본 + facts(aum/ltv/wale/occupancy/debt*/tenant*)
  market.json    # 시장 통계(협회 집계)
  glossary.json  # 용어
  sources.json   # 공식 출처 링크
schema/
  reit.schema.json   # JSON Schema(draft-07)
scripts/
  extract-seed.mjs   # 1회: index.html 임베드 → data/*.json
  embed-seed.mjs     # data/*.json → index.html 임베드 seed-data(flat, 런타임 불변)
  validate.mjs       # 무의존 검증(provenance·도메인 규칙)
  build-pages.mjs    # data/seed → /r/<ticker>/ 정적 SEO 페이지 + sitemap
.github/workflows/
  build-pages.yml    # validate → embed → build-pages → 변경 시 커밋
```

데이터 흐름:
```
사람이 data/reits.json 편집(예: LTV 입력)
  → CI: validate.mjs(실패 시 차단)
  → embed-seed.mjs(임베드 갱신)
  → build-pages.mjs(종목 페이지·sitemap 재생성)
  → 커밋·배포
프론트: 임베드 seed로 즉시 렌더 → data/reits.json fetch로 facts 머지 → Worker API로 시세/공시 머지
```

## 5. stale·오류 정책
- 일부 소스 실패 시 **전체를 최신으로 위장하지 않는다**: 갱신 실패 필드는 직전 값 유지 + `status:"stale"`.
- Worker 수집기는 `batch_runs`에 성공/실패·detail 기록. 프론트는 `_live`/`_livePrices` 플래그로 “연동 대기” 구분.
- 빈 User-Agent → 정부 API error1.html 무한리다이렉트 이슈: fetch에 UA 헤더 필수(기록됨).

## 6. 향후 수집 파이프라인 강화(P1/P2)
- raw 원본 보관 + 응답 hash + 마지막 성공시각 기록.
- 이상치 검사: AUM·DPS·LTV가 예상 범위를 벗어나면 PR 코멘트 + 병합 보류.
- 종목 수 하드코딩 제거(이미 `REITS.length` 사용). 통계는 data/market.json 기준.
- B계층(가격) 연동 시: 라이선스·호출제한·재배포 가능여부 문서 검증 후 별도 수집기.
