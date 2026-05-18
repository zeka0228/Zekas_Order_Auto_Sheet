export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  async main() {
    // TODO Phase 4: 배대지 주문서 페이지 감지 → 사이드 패널 → 폼 자동 채움.
    // 자동 제출 절대 X. 사용자 검토 후 직접 제출하도록 한다.
  },
});
