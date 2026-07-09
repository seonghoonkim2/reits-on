// DART 배당결정 공시(금전배당결정·현금현물배당결정 등)를 API 키 없이 파싱해
// '확정' 배당 정보(1주당 배당금·배당기준일·지급예정일)를 추출한다.
//  - 공개 뷰어 페이지(main.do → viewer.do)만 사용: 인증·키 불필요.
//  - 순수 파서(parse*)와 네트워크(fetch*)를 분리해 픽스처로 오프라인 테스트 가능.
//  - 문서 인코딩은 EUC-KR이 일반적 → TextDecoder('euc-kr')로 디코드.
//  - 실패는 null 반환(호출측이 조용히 건너뜀). 값을 지어내지 않는다.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 배당결정 공시 제목 판별(리츠 배당·인프라 분배 계열)
export const DIV_DECISION_RE = /(금전배당\s*결정|현금\s*[·ㆍ]?\s*현물배당\s*결정|이익배당\s*결정|분배금\s*(지급\s*)?결정)/;

// ---- 순수 파서 ----

// HTML → 텍스트 시퀀스(태그 제거, 공백 정리). 표 셀이 줄 단위로 나온다.
export function docTextSeq(html) {
  return String(html)
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;?/gi, ' ')
    .replace(/&amp;/gi, '&')
    .split(/\n+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const DATE_RE = /^(\d{4})[.\-\/년]\s?(\d{1,2})[.\-\/월]\s?(\d{1,2})일?$/;
const toISO = (s) => {
  const m = String(s || '').trim().match(DATE_RE);
  if (!m) return null;
  const [, y, mo, d] = m;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};
const toNum = (s) => {
  const t = String(s || '').replace(/,/g, '').trim();
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};

// 라벨 뒤 몇 줄 안에서 조건에 맞는 첫 값을 찾는다.
function after(seq, labelRe, pick, span = 6) {
  const i = seq.findIndex((t) => labelRe.test(t));
  if (i < 0) return null;
  for (let j = i + 1; j <= Math.min(i + span, seq.length - 1); j++) {
    const v = pick(seq[j]);
    if (v != null) return v;
  }
  return null;
}

// 배당결정 문서 본문 파싱 → 확정 배당 필드. 필수(perShare·recordDate) 없으면 null.
export function parseDividendDoc(html) {
  const seq = docTextSeq(html);
  // 1주당 배당금: 라벨 뒤 '보통주식' 다음의 숫자(종류주식 '-'는 무시)
  const perShare = after(seq, /1주당\s*배당금|1주당\s*분배금/, toNum, 4);
  const recordDate = after(seq, /배당기준일|분배기준일/, toISO, 3);
  if (perShare == null || perShare <= 0 || !recordDate) return null;

  const totalWon = after(seq, /배당금총액|분배금총액/, toNum, 3);
  const yieldPct = after(seq, /시가배당률|시가분배율/, toNum, 4);
  // 지급예정일: 날짜면 확정 지급일, 텍스트("주주총회일로부터 1개월이내" 등)면 그대로 보존
  const payIdx = seq.findIndex((t) => /배당금?지급\s*예정일|분배금?지급\s*예정일/.test(t));
  let payDate = null, payText = null;
  if (payIdx >= 0 && payIdx + 1 < seq.length) {
    const v = seq[payIdx + 1];
    payDate = toISO(v);
    if (!payDate && v && !/^[-–]$/.test(v)) payText = v;
  }
  const agmDate = after(seq, /주주총회\s*예정일/, toISO, 3);
  const decidedAt = after(seq, /이사회결의일|결정일/, toISO, 3);
  return { perShare, recordDate, payDate, payText, agmDate, decidedAt, totalWon, yieldPct };
}

// main.do HTML에서 문서번호(dcmNo) 추출: viewDoc("rcpNo","dcmNo",...) 첫 호출
export function parseDcmNo(mainHtml, rcpNo) {
  const re = new RegExp(`viewDoc\\("${rcpNo}",\\s*"(\\d+)"`);
  const m = String(mainHtml).match(re);
  if (m) return m[1];
  const any = String(mainHtml).match(/viewDoc\("\d+",\s*"(\d+)"/);
  return any ? any[1] : null;
}

// ---- 네트워크 ----

async function fetchText(url, { fetchImpl = globalThis.fetch, timeoutMs = 15000, tries = 3 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetchImpl(url, { signal: ctrl.signal, headers: { 'User-Agent': UA } });
      clearTimeout(timer);
      if (res.ok) {
        const buf = new Uint8Array(await res.arrayBuffer());
        // DART 문서는 EUC-KR이 일반적. UTF-8로 먼저 시도해 한글이 깨지면 EUC-KR 재디코드.
        const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
        if (/[가-힣]/.test(utf8) && !utf8.includes('�')) return utf8;
        try { return new TextDecoder('euc-kr').decode(buf); } catch { return utf8; }
      }
      if (res.status !== 429 && res.status < 500) return null;
    } catch { /* 재시도 */ }
    if (i < tries - 1) await sleep(1200 * (i + 1));
  }
  return null;
}

// rcpNo 하나에서 확정 배당 파싱(2회 요청: main.do → viewer.do). 실패 시 null.
export async function fetchDividendDecision(rcpNo, opts = {}) {
  const main = await fetchText(`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rcpNo}`, opts);
  if (!main) return null;
  const dcmNo = parseDcmNo(main, rcpNo);
  if (!dcmNo) return null;
  const doc = await fetchText(`https://dart.fss.or.kr/report/viewer.do?rcpNo=${rcpNo}&dcmNo=${dcmNo}&eleId=0&offset=0&length=0&dtd=HTML`, opts);
  if (!doc) return null;
  return parseDividendDoc(doc);
}
