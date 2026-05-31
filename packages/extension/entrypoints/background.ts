import { saveCartSnapshot, type CartHtmlSnapshot } from '../lib/cart-html-snapshot';
import { backfillOrderNumber, prunePendingOrders, savePendingOrder } from '../lib/storage';
import type { PendingOrder } from '../lib/schemas';

/**
 * 메시지 페이로드 타입.
 * content script → background로만 흐른다 (background는 응답 없음, fire-and-forget).
 * pending_orders 쓰기는 background 단일 주체로 모아 동시 read-modify-write race를 피한다.
 */
type RuntimeMessage =
  | { type: 'PING' }
  | { type: 'CART_HTML_SNAPSHOT'; payload: CartHtmlSnapshot }
  | { type: 'PENDING_ORDER'; payload: PendingOrder }
  | { type: 'ORDER_BACKFILL'; payload: { orderId: string; orderNumber: string } };

/**
 * pending_orders는 여러 메시지(저장·백필)와 TTL 청소가 read-modify-write하므로, 모든 변경을
 * 하나의 직렬 큐에 모아 인터리빙 race를 차단한다 — "background 단일 쓰기 주체" 불변식을 실제로 보장.
 * task 실패는 삼키되 로그만 남겨 큐가 끊기지 않게 한다.
 */
let writeChain: Promise<unknown> = Promise.resolve();
function enqueueWrite(task: () => Promise<unknown>): void {
  writeChain = writeChain.then(task).catch((e) => {
    console.error('[ZOAS] pending_orders write failed:', e);
  });
}

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener((details) => {
    console.log('[ZOAS] installed:', details.reason);
    enqueueWrite(() => prunePendingOrders()); // 설치·업데이트 시 stale 후보 청소
  });

  // 브라우저(프로필) 시작 시에도 청소 — 장기 미확정 후보가 무기한 쌓이지 않게(§1.9 candidate 정리).
  chrome.runtime.onStartup.addListener(() => {
    enqueueWrite(() => prunePendingOrders());
  });

  chrome.runtime.onMessage.addListener((msg: RuntimeMessage, _sender, sendResponse) => {
    switch (msg?.type) {
      case 'PING':
        sendResponse({ ok: true, pong: Date.now() });
        return true;
      case 'CART_HTML_SNAPSHOT':
        // content script가 페이지 navigation 직전에 보내므로 fire-and-forget.
        // chrome.storage.local.set이 비동기지만 background는 navigation 영향 안 받음 → 안전.
        // (cart 스냅샷은 별도 키라 pending_orders 큐와 무관.)
        void saveCartSnapshot(msg.payload);
        return false;
      case 'PENDING_ORDER':
        // payButton 클릭 직후 content script가 navigation 전에 보냄 → fire-and-forget.
        // 완료 페이지 폐기(§1.9) 후 후보 주문은 이 시점에 저장되고 orderNumber는 이메일 백필.
        // 저장 직후 청소를 이어 붙여, 장시간 떠 있는 세션에서도 새 결제마다 stale 후보가 정리되게 한다.
        enqueueWrite(() => savePendingOrder(msg.payload).then(() => prunePendingOrders()));
        return false;
      case 'ORDER_BACKFILL':
        // gmail content script가 주문확인 메일에서 찾은 orderNumber를 후보 주문에 채움(§1.9).
        enqueueWrite(() => backfillOrderNumber(msg.payload.orderId, msg.payload.orderNumber));
        return false;
      default:
        return false;
    }
  });
});
