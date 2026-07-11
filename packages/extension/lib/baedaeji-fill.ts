/**
 * 캡처된 주문(PendingOrder)을 배대지 주문서 폼 값으로 변환한다 (Phase 4).
 *
 * 배대지 config의 셀렉터 키(ai-proxy 프롬프트와 일치):
 *   trackingNumber · productName · declaredPrice · currency · quantity · productCategory
 *
 * ⚠️ 매핑은 잠정(provisional) — MVP 배대지 사이트(로드맵 D5)가 미정이라 실제 폼 필드명·의미를
 *    확정하지 못했다. 실측 후 조정 대상. 지금은 캡처 가능한 필드만 안전하게 매핑하고, 못 채우는
 *    필드(quantity·productCategory 등)는 값을 넣지 않아 사용자가 직접 입력하게 둔다.
 */
import type { PendingOrder, SiteConfig } from './schemas';
import { fillFormFields, type FillReport } from './form-fill';

/** 배대지 폼 필드명 → 채울 문자열 값. 값이 없는 필드는 키를 생략(undefined). */
export function orderToBaedaejiValues(
  order: PendingOrder,
): Record<string, string | undefined> {
  return {
    // 주문번호를 배대지 주문/송장 식별 필드에 넣는다(D5 실측 후 필드명 정합성 재확인).
    trackingNumber: order.orderNumber,
    productName: order.productName,
    declaredPrice:
      order.price != null ? String(order.price.amount) : undefined,
    currency: order.price?.currency,
    // quantity·productCategory는 결제 화면에서 캡처하지 않음 — 사용자 입력에 맡김.
  };
}

/**
 * 한 건의 주문(PendingOrder)을 배대지 config의 셀렉터로 root 폼에 채운다.
 * `orderToBaedaejiValues` + `fillFormFields` 조합. **자동 제출은 하지 않는다** — 값만 채우고
 * 못 채운 필드는 report.missing으로 돌려 UI가 검토를 유도한다(명세서 §8).
 */
export function fillOrderIntoForm(
  root: ParentNode,
  config: SiteConfig,
  order: PendingOrder,
): FillReport {
  return fillFormFields(root, config.selectors, orderToBaedaejiValues(order));
}
