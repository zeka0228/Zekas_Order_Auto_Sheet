import { saveCartSnapshot, type CartHtmlSnapshot } from '../lib/cart-html-snapshot';

/**
 * 메시지 페이로드 타입.
 * content script → background로만 흐른다 (background는 응답 없음, fire-and-forget).
 */
type RuntimeMessage =
  | { type: 'PING' }
  | { type: 'CART_HTML_SNAPSHOT'; payload: CartHtmlSnapshot };

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener((details) => {
    console.log('[ZOAS] installed:', details.reason);
  });

  chrome.runtime.onMessage.addListener((msg: RuntimeMessage, _sender, sendResponse) => {
    switch (msg?.type) {
      case 'PING':
        sendResponse({ ok: true, pong: Date.now() });
        return true;
      case 'CART_HTML_SNAPSHOT':
        // content script가 페이지 navigation 직전에 보내므로 fire-and-forget.
        // chrome.storage.local.set이 비동기지만 background는 navigation 영향 안 받음 → 안전.
        void saveCartSnapshot(msg.payload);
        return false;
      default:
        return false;
    }
  });
});
