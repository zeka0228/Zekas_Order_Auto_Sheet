export default defineBackground(() => {
  // TODO Phase 2: pending order → batch flush, Worker config 캐시 갱신 등
  chrome.runtime.onInstalled.addListener((details) => {
    console.log('[ZOAS] installed:', details.reason);
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    // 향후 content script ↔ background 메시지 라우터
    switch (msg?.type) {
      case 'PING':
        sendResponse({ ok: true, pong: Date.now() });
        return true;
      default:
        return false;
    }
  });
});
