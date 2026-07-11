/**
 * 배대지(배송대행지) 주문서 폼 페이지 감지 게이트 (Phase 4).
 *
 * 결제 캡처(checkout)와 달리 배대지 서비스는 한국 사이트라 국내 사이트 차단 게이트(domestic-site-gate)를
 * 통과시키면 안 된다 — 여기는 별도 트랙이다. AI 호출·UI 주입 전에 값싼 1차 판정으로,
 * "해외 배송대행 주문서 폼일 법한가"만 본다.
 *
 * ⚠️ 잠정(provisional) — MVP 배대지 사이트(로드맵 D5)가 미정이라 실측 튜닝 전이다. 보수적으로
 *    (키워드 AND 폼 필드 다수)로 잡아 오탐(무관한 한국 사이트에 패널 주입)을 줄인다.
 */

/** 배대지 주문서에서 자주 보이는 키워드 (배송대행·통관·물품정보 신청 맥락). */
const BAEDAEJI_KEYWORDS =
  /(배송대행|배대지|해외배송\s*신청|개인통관고유부호|통관부호|주문서\s*작성|물품\s*정보|상품\s*정보\s*입력|송장\s*번호|해외\s*주문번호|구매대행)/;

/**
 * 해외 배송대행 주문서 폼 페이지일 법한가.
 * 조건: 배대지 맥락 키워드가 본문에 있고 + 입력 가능한 폼 필드가 3개 이상(안내 페이지 배제).
 */
export function looksLikeBaedaejiForm(doc: Document, _url: string): boolean {
  const text = doc.body?.innerText ?? doc.body?.textContent ?? '';
  if (!BAEDAEJI_KEYWORDS.test(text)) return false;
  return countFillableInputs(doc) >= 3;
}

/** 채울 수 있는 폼 요소(텍스트류 input·select·textarea) 개수. 버튼·체크박스류는 제외. */
function countFillableInputs(doc: Document): number {
  const els = doc.querySelectorAll('input, select, textarea');
  let n = 0;
  for (const el of Array.from(els)) {
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      n += 1;
    } else if (el instanceof HTMLInputElement) {
      const t = el.type.toLowerCase();
      if (t !== 'checkbox' && t !== 'radio' && t !== 'submit' && t !== 'button' &&
          t !== 'image' && t !== 'reset' && t !== 'file' && t !== 'hidden') {
        n += 1;
      }
    }
  }
  return n;
}
