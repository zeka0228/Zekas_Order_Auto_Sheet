export default defineContentScript({
  matches: ['https://mail.google.com/*'],
  runAt: 'document_idle',
  async main() {
    // TODO Phase 3: Pro 모드 사용자 키로 메일 본문 파싱 → savePendingOrder
    console.debug('[ZOAS] gmail content script loaded');
  },
});
