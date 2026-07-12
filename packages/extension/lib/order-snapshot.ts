/**
 * 캡처된 주문 필드로 저장용 PendingOrder를 조립한다.
 *
 * 설계 진화 로그 §1.9: 완료 페이지 캡처를 폐기하면서 결제하기 클릭 스냅샷의 저장·소비·병합
 * (saveSnapshot/consumeSnapshot/mergeCapture)도 제거됐다. 이제 payButton 클릭 시점에
 * 파싱한 필드로 바로 candidate PendingOrder를 만든다. orderNumber·결제성공은 주문확인
 * 이메일에서 백필하므로 여기선 상품·가격만 있으면 충분하다.
 */
import { PendingOrderSchema, type PendingOrder } from './schemas';
import type { ParsedFields } from './checkout-parser';

/**
 * 캡처 필드로 PendingOrder를 조립한다.
 * 배대지 폼에 필요한 핵심 필드(상품명·가격)가 비면 needsHumanReview를 세워 검토를 유도한다.
 * orderNumber는 이메일 백필 대상이라 capture 시점엔 없는 게 정상 — 검토 기준에서 제외(§1.9).
 */
export function buildPendingOrder(args: {
  id: string;
  domain: string;
  url: string;
  fields: ParsedFields;
  now?: number;
}): PendingOrder {
  const { fields } = args;
  const needsHumanReview = !(fields.productName && fields.price);
  return PendingOrderSchema.parse({
    id: args.id,
    domain: args.domain,
    url: args.url,
    capturedAt: args.now ?? Date.now(),
    source: 'checkout',
    orderNumber: fields.orderNumber,
    productName: fields.productName,
    price: fields.price,
    needsHumanReview,
  });
}

/**
 * 사용자가 popup에서 직접 입력한 주문 정보로 PendingOrder를 조립한다(source: 'manual').
 * 결제 자동 캡처가 실패했거나 캡처 대상이 아닌 주문을 손으로 넣어 배대지 폼 채움에 쓰기 위함.
 * 상품명은 필수(호출측에서 보장), 금액·통화·주문번호는 선택. 가격이 없으면 needsHumanReview.
 */
export function buildManualOrder(args: {
  id: string;
  productName: string;
  amount?: number;
  currency?: string;
  orderNumber?: string;
  now?: number;
}): PendingOrder {
  const name = args.productName.trim();
  const price =
    args.amount != null && Number.isFinite(args.amount) && args.currency
      ? { amount: args.amount, currency: args.currency }
      : undefined;
  const orderNumber = args.orderNumber?.trim() || undefined;
  return PendingOrderSchema.parse({
    id: args.id,
    domain: 'manual',
    url: '',
    capturedAt: args.now ?? Date.now(),
    source: 'manual',
    orderNumber,
    productName: name || undefined,
    price,
    needsHumanReview: !(name && price),
  });
}
