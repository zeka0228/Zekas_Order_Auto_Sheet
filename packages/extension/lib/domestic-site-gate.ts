/**
 * 국내(한국) 쇼핑몰 무시 게이트 — 직구만 처리.
 *
 * ZOAS는 해외 직구 전용이므로, 결제 캡처·AI generate-config 호출 *이전*에
 * "이 사이트가 국내(한국)인가"를 로컬 신호로 판정한다.
 * 국내로 확신되면 즉시 무시 → AI 비용 절감 + 노이즈 제거.
 *
 * 판정 편향(중요): 국내로 *확신*될 때만 true.
 *   false negative(해외→국내 오판→스킵)는 핵심 기능을 깨므로
 *   false positive(국내를 처리해 약간의 비용)보다 훨씬 치명적.
 *
 * 신호 체계 (메인=법정표시, 보조=결제수단+도메인):
 *   1) 메인 단독 차단: 한국 전자상거래법 법정표시
 *      ("통신판매업신고", "사업자등록번호 XXX-XX-XXXXX" 패턴)
 *      → 해외 사이트가 이런 문구를 둘 이유가 없어 단독으로도 충분히 강함
 *   2) 보조 조합 차단: 메인이 없으면, 한국 전용 결제수단 AND 국내 도메인 신호
 *      → 둘 다 hit해야만 차단 (단일 보조 신호로는 차단 안 함)
 *
 * 본국은 한국 고정 (MVP). 향후 i18n 단계에서 일반화 가능.
 *
 * 미래 옵션 (설계 진화 로그 §1.6): 정확도 문제 발생 시
 * 다양한 신호에 가중치를 부여하는 광범위 점수제로 전환.
 */

/** 한국 전자상거래법 법정표시 — 해외 사이트엔 절대 안 나타남. */
const LEGAL_DISCLOSURE_RE =
  /(통신판매업\s*신고|사업자등록번호\s*[:：]?\s*\d{3}\s*-?\s*\d{2}\s*-?\s*\d{5})/;

/** 한국 전용 결제수단 — 해외 사이트가 노출할 이유 없음. */
const KOREAN_PAYMENT_RE =
  /(카카오페이|네이버페이|토스페이|페이코|삼성페이|무통장\s*입금|가상\s*계좌|휴대폰\s*결제)/;

/**
 * .com을 쓰는 대표 국내 쇼핑몰. .kr TLD로 못 잡는 케이스를 보완.
 * 신호 보강 목적이라 누락이 있어도 메인 신호(법정표시)가 따라잡는다.
 */
const KOREAN_DOMAINS = [
  'coupang.com',
  'ssg.com',
  'lotteon.com',
  'kakaomakers.com',
  'wemakeprice.com',
  'musinsa.com',
  'shopping.naver.com',
  'smartstore.naver.com',
];

export function isDomesticSite(doc: Document, url: string): boolean {
  const text = doc.body?.innerText ?? doc.body?.textContent ?? '';

  if (LEGAL_DISCLOSURE_RE.test(text)) return true;

  const paymentHit = KOREAN_PAYMENT_RE.test(text);
  const domainHit = hasKoreanDomainSignal(url);
  return paymentHit && domainHit;
}

function hasKoreanDomainSignal(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (hostname.endsWith('.kr')) return true;
  for (const dom of KOREAN_DOMAINS) {
    if (hostname === dom || hostname.endsWith(`.${dom}`)) return true;
  }
  return false;
}
