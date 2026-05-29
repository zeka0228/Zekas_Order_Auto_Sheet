import { scrapeOpenEmail } from '../lib/gmail-scrape';
import { backfillFromOpenEmail } from '../lib/order-email';
import { listPendingOrders } from '../lib/storage';

/**
 * Gmail 열람 시 orderNumber 백필 (설계 진화 로그 §1.9).
 *
 * 완료 페이지 캡처를 폐기하면서 orderNumber·결제성공은 주문확인 이메일에서 가져온다.
 * basic-HTML 뷰가 폐지되고 SPA 리스트 DOM은 난독화·불안정하므로, **리스트를 긁지 않고**
 * 사용자가 주문확인 메일을 *열었을 때* 그 본문(.a3s — 안정적)에서 번호를 읽어 백필한다.
 *
 * 트리거: 초기 진입 + 메일 열 때마다(hashchange). 본문이 async로 렌더되므로 약간의 지연 후 시도.
 * 중복 백필은 background의 backfillOrderNumber가 멱등하게 막는다(이미 채워졌으면 무시).
 */
export default defineContentScript({
  matches: ['https://mail.google.com/*'],
  runAt: 'document_idle',
  async main() {
    if (window.top !== window) return; // top frame만

    async function tryBackfill(): Promise<void> {
      const email = scrapeOpenEmail(document);
      if (!email) return;
      const pending = (await listPendingOrders()).filter((o) => !o.orderNumber);
      if (pending.length === 0) return;
      const hit = backfillFromOpenEmail(
        pending.map((o) => ({ id: o.id, domain: o.domain, capturedAt: o.capturedAt })),
        email,
      );
      if (hit) chrome.runtime.sendMessage({ type: 'ORDER_BACKFILL', payload: hit });
    }

    // 메일을 여는 동작은 URL 해시를 바꾼다(#inbox/<id>). 본문 렌더 시간을 주고 시도.
    window.addEventListener('hashchange', () => {
      setTimeout(() => void tryBackfill(), 800);
    });
    setTimeout(() => void tryBackfill(), 1200);
  },
});
