/**
 * 결제하기 클릭 스냅샷의 저장·소비, 그리고 완료 페이지와의 병합·주문 조립.
 *
 * 설계 진화 로그 §1.5 캡처 모델:
 *   1) 결제하기 클릭 순간 현재 화면 필드를 도메인당 "덮어쓰기" 저장 (실패 감지 불필요 —
 *      매 클릭 최신화, 마지막 클릭이 진실).
 *   2) 완료 페이지에서 스냅샷을 읽고 "즉시 삭제(consume-once)" — 옛 스냅샷이 다른 주문에
 *      잘못 달라붙는 것 방지. TTL 초과 스냅샷도 무시.
 *   3) base(완료 페이지, 주문번호·성공) 우선, snap이 빈 필드를 보충 병합.
 *
 * 저장소는 chrome.storage.local을 쓴다 — content script에서 직접 접근 가능하고 navigation을
 * 가로질러 살아남는다. (chrome.storage.session은 기본적으로 content script 비접근이라 회피.)
 */
import { PendingOrderSchema, type PendingOrder } from './schemas';
import type { ParsedFields } from './checkout-parser';

const SNAP_PREFIX = 'order_snapshot:';
/** 결제 흐름은 보통 수 분. 넉넉히 30분 지나면 stale로 간주해 폐기. */
const TTL_MS = 30 * 60_000;

interface Snapshot {
  domain: string;
  url: string;
  capturedAt: number;
  fields: ParsedFields;
}

type Area = chrome.storage.StorageArea;

const snapKey = (domain: string): string => `${SNAP_PREFIX}${domain}`;

/**
 * 결제하기 클릭 시점 스냅샷 저장. 도메인당 한 건만 — 다시 저장하면 덮어쓴다(최신화).
 */
export async function saveSnapshot(
  domain: string,
  url: string,
  fields: ParsedFields,
  now: number = Date.now(),
  area: Area = chrome.storage.local,
): Promise<void> {
  const snap: Snapshot = { domain, url, capturedAt: now, fields };
  await area.set({ [snapKey(domain)]: snap });
}

/**
 * 완료 페이지에서 스냅샷을 읽고 즉시 삭제(consume-once).
 * 스냅샷이 없거나 TTL을 넘었으면 null. (삭제는 항상 수행 — 한 번 소비하면 사라진다.)
 */
export async function consumeSnapshot(
  domain: string,
  now: number = Date.now(),
  area: Area = chrome.storage.local,
): Promise<ParsedFields | null> {
  const key = snapKey(domain);
  const got = await area.get(key);
  const snap = (got as Record<string, Snapshot | undefined>)[key];
  await area.remove(key);
  if (!snap) return null;
  if (now - snap.capturedAt > TTL_MS) return null;
  return snap.fields;
}

/**
 * base(완료 페이지 캡처) 우선, snap(클릭 스냅샷)이 빈 필드를 보충.
 * 주문번호는 완료 페이지에서만 나오므로 사실상 base가, 상품·가격은 부실한 완료 페이지를
 * snap이 메우는 식이 된다.
 */
export function mergeCapture(
  base: ParsedFields,
  snap: ParsedFields | null,
): ParsedFields {
  if (!snap) return { ...base };
  return {
    orderNumber: base.orderNumber ?? snap.orderNumber,
    productName: base.productName ?? snap.productName,
    price: base.price ?? snap.price,
  };
}

/**
 * 병합된 필드로 저장용 PendingOrder를 조립한다.
 * 핵심 필드(주문번호·상품명·가격)가 하나라도 비면 needsHumanReview를 세워 사용자 검토 유도.
 */
export function buildPendingOrder(args: {
  id: string;
  domain: string;
  url: string;
  fields: ParsedFields;
  now?: number;
}): PendingOrder {
  const { fields } = args;
  const needsHumanReview = !(
    fields.orderNumber &&
    fields.productName &&
    fields.price
  );
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
