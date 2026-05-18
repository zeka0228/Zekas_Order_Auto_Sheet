export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  allFrames: true,
  async main() {
    // TODO Phase 2: looksLikeCheckoutPage → config 조회 → 파싱 → savePendingOrder
    // 현재는 skeleton: heuristic 로깅만 수행.
    if (!looksLikeCheckoutPage(document)) return;
    console.debug('[ZOAS] checkout-like page detected:', location.href);
  },
});

function looksLikeCheckoutPage(doc: Document): boolean {
  const url = location.href.toLowerCase();
  if (/(thank|complete|success|order|receipt|confirmation)/.test(url)) return true;

  const text = doc.body?.innerText ?? '';
  return /(order\s*number|order\s*id|주문번호|注文番号|订单号)/i.test(text);
}
