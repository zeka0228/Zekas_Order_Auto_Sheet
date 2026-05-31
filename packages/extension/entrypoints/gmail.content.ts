import { backfillOnOpenEmail } from '../lib/gmail-backfill';
import { extractFullBodyText } from '../lib/gmail-scrape';
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

    /**
     * 전체-메일 뷰(view=lg) URL을 fetch해 잘리지 않은 본문 텍스트를 받는다 (§1.9 후속).
     * mail.google.com 동일 출처라 쿠키 포함 fetch가 된다. 실패는 best-effort로 삼키고 빈 문자열
     * 반환 — 그러면 백필을 못 할 뿐, 잘린 본문 기준 기존 동작에서 퇴보하지 않는다.
     */
    async function fetchFullBodyText(url: string): Promise<string> {
      try {
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) return '';
        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        return extractFullBodyText(doc);
      } catch {
        return '';
      }
    }

    async function tryBackfill(): Promise<void> {
      const pending = (await listPendingOrders()).filter((o) => !o.orderNumber);
      if (pending.length === 0) return;
      const candidates = pending.map((o) => ({
        id: o.id,
        domain: o.domain,
        capturedAt: o.capturedAt,
        price: o.price,
        productName: o.productName,
      }));

      // 오케스트레이션(클립 감지·전체 본문 재시도 포함)은 lib/gmail-backfill로 분리해 단위 테스트한다.
      const hit = await backfillOnOpenEmail({ doc: document, candidates, fetchFullText: fetchFullBodyText });
      if (hit) chrome.runtime.sendMessage({ type: 'ORDER_BACKFILL', payload: hit });
    }

    // 메일을 여는 동작은 URL 해시를 바꾼다(#inbox/<id>). 본문 렌더 시간을 주고 시도.
    window.addEventListener('hashchange', () => {
      setTimeout(() => void tryBackfill(), 800);
    });
    setTimeout(() => void tryBackfill(), 1200);
  },
});
