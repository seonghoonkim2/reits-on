// reits-on 라이브 시세 Cloudflare Worker
// ─────────────────────────────────────────────────────────────────────────────
// 국내 상장 리츠의 현재가/전일대비를 공개 소스(Yahoo Finance)에서 받아 제공한다.
// 종목 유니버스(티커 목록)는 사이트의 단일 진실원천 data/reits.json에서 끌어와
// 백엔드/프론트의 종목 목록이 어긋나지 않게 한다.
//
// 엔드포인트
//   GET /v1/prices                  → 전체 리츠 시세
//   GET /v1/prices?tickers=A,B,C    → 지정 티커만
//   GET /healthz                    → 상태 점검
//
// 배포:  wrangler deploy   (wrangler.toml의 name을 reits-on-api 등으로 설정)
// 기존 워커에 통합하려면 README.md의 "기존 /v1/reits에 통합" 항목 참고.
//
// 주의: 시세는 장중 실시간이 아닌 최근 체결가 기준이며, 정보 제공용이다.

const REITS_JSON = 'https://seonghoonkim2.github.io/reits-on/data/reits.json';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const EDGE_TTL = 300; // 초. 엣지 캐시 + 브라우저 캐시(최근 종가라 5분이면 충분)

const num = (v) => (typeof v === 'number' && isFinite(v)) ? v : null;
const round2 = (v) => Math.round(v * 100) / 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const yahooSymbols = (t) => [`${t}.KS`, `${t}.KQ`];

async function fetchChart(symbol, tries = 3) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2d`;
  for (let i = 0; i < tries; i++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, accept: 'application/json' } });
      clearTimeout(timer);
      if (res.ok) return await res.json();
      if (res.status !== 429 && res.status < 500) return null; // 404 등은 즉시 포기
    } catch { /* 재시도 */ }
    if (i < tries - 1) await sleep(800 * (i + 1));
  }
  return null;
}

// 단일 티커 시세 스냅샷. 없으면 null.
export async function fetchQuote(ticker) {
  for (const symbol of yahooSymbols(ticker)) {
    const json = await fetchChart(symbol);
    const meta = json?.chart?.result?.[0]?.meta;
    const price = num(meta?.regularMarketPrice);
    if (meta && price != null && price > 0) {
      const prev = num(meta.chartPreviousClose);
      const changePct = (prev != null && prev > 0) ? round2((price - prev) / prev * 100) : null;
      const priceAsOf = num(meta.regularMarketTime) != null
        ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(meta.regularMarketTime * 1000))
        : null;
      return { ticker, symbol, price, changePct, currency: meta.currency || 'KRW', priceAsOf };
    }
  }
  return null;
}

// 여러 티커를 레이트리밋을 피해 순차 조회.
export async function fetchQuotes(tickers, gapMs = 300) {
  const out = {};
  for (const t of tickers) {
    const q = await fetchQuote(t);
    if (q) out[t] = q;
    if (gapMs) await sleep(gapMs);
  }
  return out;
}

// data/reits.json에서 티커 유니버스를 가져온다(실패 시 빈 배열).
async function tickerUniverse() {
  try {
    const res = await fetch(REITS_JSON, { headers: { accept: 'application/json' } });
    if (!res.ok) return [];
    const doc = await res.json();
    return (doc.reits || []).map((r) => r.ticker).filter(Boolean);
  } catch { return []; }
}

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'cache-control': `public, max-age=${EDGE_TTL}`,
  },
});

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, OPTIONS',
        'access-control-allow-headers': 'content-type',
      } });
    }
    if (url.pathname === '/healthz') return json({ ok: true });

    if (url.pathname === '/v1/prices') {
      // 엣지 캐시 우선
      const cache = caches.default;
      const hit = await cache.match(request);
      if (hit) return hit;

      const q = url.searchParams.get('tickers');
      const tickers = q ? q.split(',').map((s) => s.trim()).filter(Boolean) : await tickerUniverse();
      if (!tickers.length) return json({ error: 'no tickers' }, 502);

      const quotes = await fetchQuotes(tickers);
      const body = {
        retrievedAt: new Date().toISOString(),
        currency: 'KRW',
        source: 'yahoo-finance',
        count: Object.keys(quotes).length,
        prices: quotes,
      };
      const res = json(body);
      // 비차단 캐시 저장
      try { await cache.put(request, res.clone()); } catch { /* noop */ }
      return res;
    }

    return json({ error: 'not found' }, 404);
  },
};
