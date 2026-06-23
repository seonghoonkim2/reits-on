# reits-on 백엔드 — 라이브 시세 워커

국내 상장 리츠의 **현재가/전일대비**를 공개 소스(Yahoo Finance)에서 받아 제공하는
Cloudflare Worker입니다. 종목 목록은 사이트의 단일 진실원천
[`data/reits.json`](../data/reits.json)에서 끌어와 프론트/백엔드가 어긋나지 않습니다.

> ⚠️ 시세는 장중 실시간이 아닌 **최근 체결가** 기준이며 정보 제공용입니다.
> Yahoo Finance 사용은 해당 서비스 약관을 확인하세요. 상용·대량 트래픽이라면
> KIS/증권사 OpenAPI, KRX 정식 데이터 등 라이선스가 명확한 소스 사용을 권장합니다.

## 엔드포인트

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/v1/prices` | 전체 리츠 시세 |
| GET | `/v1/prices?tickers=365550,330590` | 지정 티커만 |
| GET | `/healthz` | 상태 점검 |

응답 예:

```json
{
  "retrievedAt": "2026-06-23T07:30:00.000Z",
  "currency": "KRW",
  "source": "yahoo-finance",
  "count": 25,
  "prices": {
    "365550": { "ticker": "365550", "symbol": "365550.KS", "price": 3445, "changePct": -6.39, "currency": "KRW", "priceAsOf": "2026-06-23" }
  }
}
```

- `access-control-allow-origin: *` + `cache-control: max-age=300` 이라 정적 사이트에서 바로 호출 가능하고, 엣지 캐시(`caches.default`)로 5분간 재사용합니다.

## 배포

```bash
cd backend
npm i -g wrangler        # 최초 1회
wrangler login
wrangler deploy
```

`wrangler.toml`의 `name`을 원하는 워커명으로 바꾸세요. 커스텀 도메인/라우트는
주석 처리된 `routes` 예시를 참고하면 됩니다.

## 기존 `reits-on-api` 워커(`/v1/reits`)에 통합

이미 `/v1/reits`가 종목 메타(`annualDpsEst` 등)를 내려주고 있고 `price`만 `null`이라면,
응답을 만들기 직전에 아래처럼 시세만 채워 넣으면 프론트가 그대로 사용합니다.
`worker.mjs`의 `fetchQuotes`를 그대로 가져다 쓰면 됩니다.

```js
import { fetchQuotes } from './worker.mjs'; // 또는 같은 로직을 인라인

// /v1/reits 핸들러에서 list = [{ ticker, annualDpsEst, price:null, ... }] 를 만든 뒤:
const quotes = await fetchQuotes(list.map(r => r.ticker));
for (const r of list) {
  const q = quotes[r.ticker];
  if (q) { r.price = q.price; r.changePct = q.changePct; r.priceAsOf = q.priceAsOf; }
}
```

> 현재가 기준 수익률(`yieldPriceBasis`)은 **의도적으로 자동 계산하지 않습니다.**
> `최근배당 × 횟수`(annualDpsEst)는 일회성·특별배당을 과대계상해 현재가로 나누면
> 비현실적 수치(예: 30%대)가 나오기 때문입니다. 신뢰할 수 있는 12개월 추적 DPS가
> 확보되면 그때 백엔드에서 채우세요. (프론트는 `yieldPriceBasis`가 있을 때만 표시)

## 프론트와의 관계 (이중화)

- **프론트 파이프라인**([`scripts/fetch-data.mjs`](../scripts/fetch-data.mjs))은
  매일 빌드 시 `/v1/reits`의 `price`가 비어 있으면 **동일한 로직으로 Yahoo에서 폴백 수집**해
  `data/reits.json` → 임베드 seed에 시세를 넣습니다. 따라서 백엔드 없이도 사이트에 시세가 표시됩니다.
- 백엔드가 `price`를 채우면 프론트는 **백엔드(공식) 값을 우선**합니다.
- 시세 수집 핵심 로직은 [`scripts/lib/krx-price.mjs`](../scripts/lib/krx-price.mjs)와
  본 워커가 동일하며, 단위 테스트는 [`tests/krx-price.test.mjs`](../tests/krx-price.test.mjs)에 있습니다.
