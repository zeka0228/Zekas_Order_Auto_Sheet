/**
 * 결제 캡처 content script의 순수 판정 로직 (DOM·chrome API 없이 단위 테스트 가능).
 *
 * 페이지 역할 판정 (설계 진화 로그 §1.5):
 *   - 주문번호가 잡히면 → 완료 페이지 (확정 캡처 + 스냅샷 병합)
 *   - 아니고 payButton 셀렉터가 매칭되면 → 결제 직전 페이지 (클릭 스냅샷 부착)
 */

/** AI/네트워크 호출 전 값싼 1차 게이트 — 결제·완료 페이지일 법한가. */
export function looksLikeCheckoutOrCompletion(doc: Document, url: string): boolean {
  const u = url.toLowerCase();
  if (
    /(cart|checkout|order|payment|pay|thank|complete|success|receipt|confirm|注文|決済|購入|주문|결제|구매)/.test(
      u,
    )
  ) {
    return true;
  }
  const text = doc.body?.innerText ?? '';
  return /(order\s*number|order\s*id|주문번호|注文番号|订单号|お支払い|ご注文|決済|결제완료|주문완료)/i.test(
    text,
  );
}

export type PageRole = 'completion' | 'prepay' | 'none';

/**
 * 파싱 결과(주문번호 존재) + payButton 셀렉터 매칭으로 페이지 역할 결정.
 * 완료 페이지가 우선 — 주문번호가 잡히면 결제 직전 단계가 아니다.
 */
export function decidePageRole(args: {
  hasOrderNumber: boolean;
  hasPayButton: boolean;
}): PageRole {
  if (args.hasOrderNumber) return 'completion';
  if (args.hasPayButton) return 'prepay';
  return 'none';
}
