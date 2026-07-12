/**
 * 배대지(배송대행지) 주문서 폼 페이지 감지 (Phase 4).
 *
 * 배대지는 쇼핑몰과 성격이 다르다: 쇼핑몰은 매번 다른 사이트라 휴리스틱+AI 자동 생성이 맞지만,
 * 배대지는 **개인당 사실상 고정 1개**(자기가 쓰는 배송대행사)다. 그래서 1차 판정은 **사용자
 * 등록 도메인**으로 한다 — 등록 도메인에서 폼이 보일 때만 활성화(오탐 0). 결제 캡처(checkout)와
 * 달리 국내 사이트 차단 게이트(domestic-site-gate)와는 무관한 별도 트랙이다(배대지=한국 사이트).
 *
 * 휴리스틱 키워드(`looksLikeBaedaejiForm`)는 활성화 조건이 아니라, 미등록 사이트에서 "이 사이트를
 * 배대지로 등록할까요?"를 제안하는 하이브리드 신호로 남겨둔다(향후).
 */
import { mainDomainLabel } from './order-email';

/** 채우면 안 되는 input type. */
const NON_FILLABLE_INPUT = new Set([
  'checkbox',
  'radio',
  'submit',
  'button',
  'image',
  'reset',
  'file',
  'hidden',
]);

/** 현재 호스트가 등록된 배대지 도메인 중 하나인가(www·서브도메인·TLD 정규화 후 핵심 라벨 비교). */
export function isRegisteredBaedaejiDomain(
  host: string,
  registered: string[],
): boolean {
  const target = hostLabel(host);
  if (!target) return false;
  return registered.some((d) => {
    const label = hostLabel(d);
    return label.length > 0 && label === target;
  });
}

/** 채울 수 있는 폼 필드(텍스트류 input·select·textarea)가 min개 이상 있는가 — 주문서다운 폼 판별. */
export function hasFillableForm(doc: Document, min = 3): boolean {
  return countFillableInputs(doc) >= min;
}

/**
 * 배대지 폼 채움을 활성화할지 최종 판정.
 * 등록 도메인 AND 채울 수 있는 폼이 있으면 활성화. (등록 안 된 도메인은 폼이 있어도 무시.)
 */
export function shouldActivateBaedaeji(args: {
  host: string;
  doc: Document;
  registeredDomains: string[];
}): boolean {
  return (
    isRegisteredBaedaejiDomain(args.host, args.registeredDomains) &&
    hasFillableForm(args.doc)
  );
}

/**
 * (하이브리드 향후용) 해외 배송대행 주문서 폼일 법한가 — 등록 제안 신호.
 * 배대지 맥락 키워드 + 폼 필드 3개 이상. 활성화 조건이 아니라 미등록 사이트 등록 유도에 쓴다.
 */
const BAEDAEJI_KEYWORDS =
  /(배송대행|배대지|해외배송\s*신청|개인통관고유부호|통관부호|주문서\s*작성|물품\s*정보|상품\s*정보\s*입력|송장\s*번호|해외\s*주문번호|구매대행)/;

export function looksLikeBaedaejiForm(doc: Document, _url: string): boolean {
  const text = doc.body?.innerText ?? doc.body?.textContent ?? '';
  if (!BAEDAEJI_KEYWORDS.test(text)) return false;
  return hasFillableForm(doc);
}

/** 입력 문자열(URL·도메인 무엇이든)에서 핵심 도메인 라벨을 뽑는다. */
function hostLabel(input: string): string {
  const s = input.trim().toLowerCase().replace(/^[a-z]+:\/\//, ''); // scheme 제거
  const host = s.split(/[/?#]/)[0] ?? ''; // path·query·hash 앞부분만
  return mainDomainLabel(host);
}

function countFillableInputs(doc: Document): number {
  const els = doc.querySelectorAll('input, select, textarea');
  let n = 0;
  for (const el of Array.from(els)) {
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      n += 1;
    } else if (el instanceof HTMLInputElement) {
      if (!NON_FILLABLE_INPUT.has(el.type.toLowerCase())) n += 1;
    }
  }
  return n;
}
