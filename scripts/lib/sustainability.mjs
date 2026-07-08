// 배당 지속가능성 '신호' — 종합점수·추천이 아니라, 배당에 영향을 줄 수 있는 공시 '사실'을
// 규칙으로 모아 사실 서술 + 근거 + 출처로 제시한다. 판단은 이용자 몫(교육용).
// 입력: r(평탄 seed) · facts(reits.json facts) · detail(reportDetail). 부재 값은 'na'로 정직하게 비운다.

// "…%" 문자열에서 숫자 추출
export function parsePct(s) {
  const m = String(s == null ? '' : s).replace(/,/g, '').match(/(-?\d+(?:\.\d+)?)\s*%/);
  return m ? parseFloat(m[1]) : null;
}

// facts[key]가 실측(actual)일 때만 반환
function actual(facts, key) {
  const v = facts && facts[key];
  return (v && v.status === 'actual' && v.value != null) ? v : null;
}

// 배당성향: reportDetail.dividends.history의 note("배당성향 132.9%")에서 최근값 파싱
function payoutFromHistory(detail) {
  const h = (detail && detail.dividends && detail.dividends.history) || [];
  for (const x of h) {
    if (x && /배당성향/.test(String(x.note))) {
      const p = parsePct(x.note);
      if (p != null) return { p, period: x.period };
    }
  }
  return null;
}

// 신호 배열 반환: [{ level:'ok'|'watch'|'alert'|'na', label, text, source, asOf }]
export function sustainabilitySignals(r, facts, detail) {
  facts = facts || {}; detail = detail || {};
  const S = [];
  const push = (level, label, text, source, asOf) => S.push({ level, label, text, source: source || null, asOf: asOf || null });

  // 0) 중대 리스크(회생·상장폐지·무배당 경고 등) — 최우선
  if (r.risk) push(r.risk.level === 'high' ? 'alert' : 'watch', '중대 리스크', r.risk.label + (r.risk.note ? ' — ' + r.risk.note : ''));

  // 1) 무배당(최근 12개월 실지급 없음)
  if (r.ttmQuality === 'nodiv') push('alert', '최근 12개월 배당', '최근 12개월 실지급 배당이 없습니다(무배당).');

  // 2) 배당성향 — 실제값 우선, 없으면 100% 초과 플래그.
  //    단 무배당/무실적 종목은 과거 배당성향이 현재를 오도하므로 생략(무배당 신호로 대체).
  const paysNow = r.ttmQuality !== 'nodiv' && r.ttmQuality !== 'none';
  const po = paysNow ? payoutFromHistory(detail) : null;
  if (po) {
    const { p, period } = po;
    push(p > 100 ? 'alert' : (p >= 90 ? 'watch' : 'ok'), '배당성향',
      '최근(' + period + ') 배당성향 약 ' + p + '%' +
      (p > 100 ? ' — 순이익을 초과한 배당입니다(자산매각익·초과배당 등 재원을 확인하세요).'
        : p >= 90 ? ' — 이익의 대부분을 배당(정상 범위이나 추가 여력은 작습니다).'
          : ' — 이익 대비 배당 여력이 있는 편입니다.'),
      detail.sourceUrl, detail.asOf);
  } else if (paysNow && r.ttmPayoutOver100) {
    push('alert', '배당성향', '최근 배당이 순이익을 초과한 것으로 확인됩니다(배당성향 100% 초과). 반복 가능성은 재원을 확인해야 합니다.', detail.sourceUrl, detail.asOf);
  }

  // 3) 특별배당 의존(일회성)
  if (r.ttmSpecial) push('watch', '특별배당 포함', '최근 12개월 배당에 일회성 특별배당이 포함됩니다. 경상(반복) 배당과 구분해서 보세요.');

  // 4) LTV(차입 비율)
  const ltv = actual(facts, 'ltv');
  if (ltv) {
    const v = ltv.value;
    push(v >= 60 ? 'alert' : (v >= 50 ? 'watch' : 'ok'), 'LTV(차입 비율)',
      'LTV ' + ltv.display + (v >= 60 ? ' — 높은 편(금리 상승·리파이낸싱 시 배당 압박이 커질 수 있습니다).'
        : v >= 50 ? ' — 중간 수준(금리 민감도를 함께 보세요).'
          : ' — 낮은 편입니다.'), ltv.sourceUrl, ltv.asOf);
  } else {
    push('na', 'LTV(차입 비율)', '공시에서 확인되지 않아 표시하지 않습니다.');
  }

  // 5) 고정금리 비중
  const fx = actual(facts, 'debtFixedRatio');
  if (fx) {
    const v = fx.value;
    push(v <= 30 ? 'watch' : 'ok', '고정금리 비중',
      '고정금리 ' + fx.display + (v <= 30 ? ' — 낮은 편(시장금리 상승에 이자비용이 민감합니다).' : ' — 금리 변동 방어력이 있는 편입니다.'), fx.sourceUrl, fx.asOf);
  }

  // 6) 12개월 내 차입 만기(리파이낸싱 절벽)
  const mt = actual(facts, 'debtMaturity12m');
  if (mt) {
    const v = mt.value;
    push(v >= 30 ? 'watch' : 'ok', '12개월 내 차입 만기',
      mt.display + ' 만기 도래' + (v >= 30 ? ' — 리파이낸싱(재조달) 조건이 배당에 영향을 줄 수 있습니다.' : ''), mt.sourceUrl, mt.asOf);
  }

  // 7) WALE(임대차 잔여기간) — 짧으면 재계약·공실 변동 위험
  const wale = actual(facts, 'wale');
  if (wale && wale.value < 2) push('watch', '임대차 잔여기간(WALE)', 'WALE ' + wale.display + ' — 짧은 편(재계약·공실 변동 위험을 확인하세요).', wale.sourceUrl, wale.asOf);

  // 8) 임대율(공실)
  const occ = actual(facts, 'occupancy');
  if (occ && occ.value < 90) push('watch', '임대율', '임대율 ' + occ.display + ' — 낮은 편(공실이 임대수익에 영향).', occ.sourceUrl, occ.asOf);

  // 9) 손익(순손실·적자) — 배당 재원 압박
  const fin = ((detail.financials) || []).map((x) => String(x.label) + ' ' + String(x.value)).join(' ');
  if (/순손실|적자/.test(fin)) push('alert', '손익', '최근 재무에서 순손실·적자가 확인됩니다(배당 재원에 부담).', detail.sourceUrl, detail.asOf);

  return S;
}

// 레벨별 개수(사실 집계 — 순위·점수 아님)
export function signalCounts(signals) {
  const c = { ok: 0, watch: 0, alert: 0, na: 0 };
  for (const s of signals) c[s.level] = (c[s.level] || 0) + 1;
  return c;
}
