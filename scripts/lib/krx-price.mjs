// KRX 상장 종목의 시세를 공개 소스(Yahoo Finance chart API)에서 받아온다.
//  - 백엔드 API가 price를 제공하지 못할 때의 폴백 시세원.
//  - 순수 함수형 모듈: 네트워크만 사용하고 파일/전역 상태에 의존하지 않는다 →
//    프론트 수집 스크립트(fetch-data.mjs)와 백엔드 워커가 동일 로직을 공유할 수 있다.
//  - 실패는 조용히 건너뛴다(해당 티커만 누락). 호출측이 부분 결과를 안전하게 병합한다.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const num = (v) => (typeof v === 'number' && isFinite(v)) ? v : null;
const round2 = (v) => Math.round(v * 100) / 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 한국거래소 KRX 단축코드 → Yahoo 심볼. 국내 리츠는 거의 KOSPI(.KS)이며,
// 못 찾으면 KOSDAQ(.KQ)로 한 번 더 시도한다.
const yahooSymbols = (ticker) => [`${ticker}.KS`, `${ticker}.KQ`];

async function fetchChart(symbol, { fetchImpl, timeoutMs = 12000, tries = 3 } = {}) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2d`;
  for (let i = 0; i < tries; i++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetchImpl(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, accept: 'application/json' } });
      clearTimeout(timer);
      if (res.ok) return await res.json();
      // 429(레이트리밋)·5xx는 백오프 후 재시도, 그 외(404 등)는 즉시 포기
      if (res.status !== 429 && res.status < 500) return null;
    } catch { /* 타임아웃·네트워크 오류 → 재시도 */ }
    if (i < tries - 1) await sleep(800 * (i + 1));
  }
  return null;
}

// 단일 티커의 시세 스냅샷을 구한다. 없으면 null.
export async function fetchQuote(ticker, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  for (const symbol of yahooSymbols(ticker)) {
    const json = await fetchChart(symbol, { ...opts, fetchImpl });
    const meta = json?.chart?.result?.[0]?.meta;
    const price = num(meta?.regularMarketPrice);
    if (meta && price != null && price > 0) {
      const prevClose = num(meta.chartPreviousClose);
      const changePct = (prevClose != null && prevClose > 0) ? round2((price - prevClose) / prevClose * 100) : null;
      let asOf = null;
      if (num(meta.regularMarketTime) != null) {
        // 거래소 시각(KST) 기준 날짜 YYYY-MM-DD
        asOf = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(meta.regularMarketTime * 1000));
      }
      return { ticker, symbol, price, prevClose, changePct, currency: meta.currency || 'KRW', priceAsOf: asOf };
    }
  }
  return null;
}

// 여러 티커의 시세를 받아 { [ticker]: quote } 맵으로 반환.
// 레이트리밋을 피하려고 소량씩 순차 처리하며, 각 요청 사이에 간격을 둔다.
export async function fetchQuotes(tickers, opts = {}) {
  const gap = opts.gapMs ?? 350;
  const out = {};
  for (const t of tickers) {
    const q = await fetchQuote(t, opts);
    if (q) out[t] = q;
    if (gap) await sleep(gap);
  }
  return out;
}

// 연환산 추정 배당(annualDpsEst)과 현재가로 현재가 기준 배당수익률(%)을 계산.
export const yieldFromPrice = (annualDpsEst, price) =>
  (num(annualDpsEst) != null && num(price) != null && price > 0) ? round2(annualDpsEst / price * 100) : null;
