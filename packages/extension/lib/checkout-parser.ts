/**
 * 결제 페이지/완료 페이지에서 config 셀렉터로 주문 필드를 추출한다.
 *
 * 캡처는 두 시점이 같은 파서를 공유한다 (설계 진화 로그 §1.5):
 *   - 결제하기 클릭 시점 → 상품·가격 (주문번호 없음)
 *   - 완료 페이지 → 주문번호 (+ 가능하면 데이터)
 * 두 결과는 order-snapshot의 mergeCapture로 합쳐진다.
 */
import { detectCurrency } from './html-masker';
import type { PendingOrder } from './schemas';

/** parseWithSelectors가 채울 수 있는 부분 필드. PendingOrder의 데이터 필드만. */
export type ParsedFields = Partial<
  Pick<PendingOrder, 'orderNumber' | 'productName' | 'price'>
>;

/**
 * 가격 문자열에서 통화와 금액을 분리한다.
 * 예: "¥3,850" → { amount: 3850, currency: 'JPY' }, "$1,299.99" → { 1299.99, USD }
 * 숫자가 없으면(예: "Free") null.
 */
export function parsePrice(
  text: string,
): { amount: number; currency: string } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  // 천단위 쉼표 포함 숫자(+ 소수점) 추출
  const m = trimmed.match(/\d[\d,]*(?:\.\d+)?/);
  if (!m) return null;
  const amount = Number(m[0].replace(/,/g, ''));
  if (!Number.isFinite(amount)) return null;
  return { amount, currency: detectCurrency(trimmed) };
}

/**
 * config의 `selectors`(필드명 → CSS 셀렉터)로 root에서 텍스트를 뽑아 필드를 채운다.
 * 셀렉터가 없거나·매칭 안 되거나·텍스트가 비면 해당 필드는 생략(부분 결과 허용).
 */
export function parseWithSelectors(
  root: ParentNode,
  selectors: Record<string, string>,
): ParsedFields {
  const out: ParsedFields = {};

  const orderNumber = textOf(root, selectors.orderNumber);
  if (orderNumber) out.orderNumber = orderNumber;

  const productName = textOf(root, selectors.productName);
  if (productName) out.productName = productName;

  const priceText = textOf(root, selectors.price);
  if (priceText) {
    const price = parsePrice(priceText);
    if (price) out.price = price;
  }

  return out;
}

/** 배대지 채움·주문 식별에 필요한 최소 필드(상품명·가격)가 모두 있는지. */
export function hasCriticalFields(fields: ParsedFields): boolean {
  return Boolean(fields.productName && fields.price);
}

function textOf(root: ParentNode, selector: string | undefined): string | undefined {
  if (!selector) return undefined;
  const el = safeQuery(root, selector);
  const t = el?.textContent?.trim();
  return t && t.length > 0 ? t : undefined;
}

/** 잘못된 셀렉터 문자열(AI가 생성한 깨진 셀렉터 등)이 throw하지 않도록 방어. */
function safeQuery(root: ParentNode, selector: string): Element | null {
  try {
    return root.querySelector(selector);
  } catch {
    return null;
  }
}
