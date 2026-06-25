import { backfillOnOpenEmail } from '../lib/gmail-backfill';
import { extractFullBodyText } from '../lib/gmail-scrape';
import { findSearchResultRows, pickRowToOpen } from '../lib/gmail-search';
import { getSettings, listPendingOrders } from '../lib/storage';
import type { BackfillCandidate } from '../lib/order-email';

/**
 * Gmail 열람 시 orderNumber 백필 (설계 진화 로그 §1.9) + background 탭 자동 백필 (§1.9 후속).
 *
 * 완료 페이지 캡처를 폐기하면서 orderNumber·결제성공은 주문확인 이메일에서 가져온다.
 *
 * 두 경로가 한 content script에 공존한다:
 *  - **수동(passive)**: 사용자가 일반 Gmail 탭에서 주문확인 메일을 *열면* 그 본문(.a3s)에서 번호를
 *    읽어 백필(초기 진입 + hashchange).
 *  - **자동(auto)**: background가 결제 직후 백그라운드로 연 검색 탭이면(핸드셰이크로 확인), 검색
 *    결과에서 판매처 메일 행을 클릭해 열고 ~15초간 재시도(tier-1/2). 성공/소진을 background에 알린다.
 *
 * 중복 백필은 background의 backfillOrderNumber가 멱등하게 막는다(이미 채워졌으면 무시).
 */
export default defineContentScript({
  matches: ['https://mail.google.com/*'],
  runAt: 'document_idle',
  async main() {
    if (window.top !== window) return; // top frame만

    // 온보딩에서 "배송대행 주문확인 메일을 Gmail로 받지 않음"을 고른 사용자는 메일 e2e를 돌리지 않는다
    // (주문번호는 popup 수동 입력에 의존). 설정 변경 후엔 Gmail 탭을 새로고침해야 반영된다.
    const settings = await getSettings();
    if (!settings.gmailOrderEmails) return;

    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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

    /** 열린 메일 1건으로 백필을 시도하고, 백필이 일어났으면 true. */
    async function tryBackfill(): Promise<boolean> {
      const pending = (await listPendingOrders()).filter((o) => !o.orderNumber);
      if (pending.length === 0) return false;
      const candidates = pending.map((o) => ({
        id: o.id,
        domain: o.domain,
        capturedAt: o.capturedAt,
        price: o.price,
        productName: o.productName,
      }));

      // 오케스트레이션(클립 감지·전체 본문 재시도 포함)은 lib/gmail-backfill로 분리해 단위 테스트한다.
      const hit = await backfillOnOpenEmail({ doc: document, candidates, fetchFullText: fetchFullBodyText });
      if (hit) {
        chrome.runtime.sendMessage({ type: 'ORDER_BACKFILL', payload: hit });
        return true;
      }
      return false;
    }

    // ── 수동(passive) 경로 — 사용자가 직접 연 메일 ──
    // 메일을 여는 동작은 URL 해시를 바꾼다(#inbox/<id>). 본문 렌더 시간을 주고 시도.
    window.addEventListener('hashchange', () => {
      setTimeout(() => void tryBackfill(), 800);
    });
    setTimeout(() => void tryBackfill(), 1200);

    // ── 자동(auto) 경로 — background가 연 검색 탭인지 핸드셰이크로 확인 ──
    const query = searchQueryFromHash();
    try {
      const res = (await chrome.runtime.sendMessage({ type: 'AUTO_TAB_READY', query })) as
        | { auto: boolean; orderIds?: string[]; query?: string }
        | undefined;
      if (res?.auto) void runAutoBackfill(res.orderIds ?? [], res.query ?? query ?? '');
    } catch {
      /* background 미응답 — 일반 탭처럼 passive만 동작 */
    }

    /** 현재 URL 해시의 Gmail 검색 쿼리(#search/<encoded>)를 디코드. 검색 페이지가 아니면 undefined. */
    function searchQueryFromHash(): string | undefined {
      const m = location.hash.match(/^#search\/(.+)$/);
      return m?.[1] ? decodeURIComponent(m[1]) : undefined;
    }

    /** 검색 페이지가 아니면 검색 해시로 이동(결과 재렌더 유도). */
    function ensureSearchHash(q: string): void {
      const target = `#search/${encodeURIComponent(q)}`;
      if (location.hash !== target) location.hash = target;
    }

    /** 검색 결과 행이 렌더될 때까지 폴링(200ms 간격). deadline·최대 6초까지. */
    async function waitForRows(deadline: number): Promise<ReturnType<typeof findSearchResultRows>> {
      const until = Math.min(deadline, Date.now() + 6000);
      for (;;) {
        const rows = findSearchResultRows(document);
        if (rows.length > 0 || Date.now() >= until) return rows;
        await sleep(200);
      }
    }

    /** 대상 후보(orderNumber 빈 것)들을 BackfillCandidate로 로드. */
    async function loadCandidates(targetIds: string[]): Promise<BackfillCandidate[]> {
      return (await listPendingOrders())
        .filter((o) => targetIds.includes(o.id) && !o.orderNumber)
        .map((o) => ({
          id: o.id,
          domain: o.domain,
          capturedAt: o.capturedAt,
          price: o.price,
          productName: o.productName,
        }));
    }

    /**
     * 자동 백필 (tier-1/2): 검색 결과에서 판매처 메일 행을 열어 ~15초간 재시도한다.
     * - 대상이 모두 채워지면(수동 입력 포함) 즉시 성공 종료.
     * - 성공/소진을 background에 알려 탭 정리·tier-3 판단을 맡긴다.
     * 모든 단계 try/catch로 감싸 선택자가 깨져도 throw하지 않는다(graceful degrade → 수동 폴백).
     */
    async function runAutoBackfill(targetIds: string[], q: string): Promise<void> {
      const deadline = Date.now() + 15_000;
      try {
        while (Date.now() < deadline) {
          const candidates = await loadCandidates(targetIds);
          if (candidates.length === 0) {
            // 이미 채워짐(이전 시도 성공 또는 사용자 수동 입력) → 성공으로 종료.
            chrome.runtime.sendMessage({ type: 'AUTO_BACKFILL_DONE' });
            return;
          }
          if (q) ensureSearchHash(q);
          const rows = await waitForRows(deadline);
          const row = pickRowToOpen(rows, candidates);
          if (row) {
            (row as HTMLElement).click();
            await sleep(1200); // 본문 렌더 대기
            if (await tryBackfill()) {
              chrome.runtime.sendMessage({ type: 'AUTO_BACKFILL_DONE' });
              return;
            }
          }
          await sleep(2000); // 메일 지연 도착·오매칭 — 잠시 후 재검색
        }
      } catch (e) {
        console.debug('[ZOAS] auto backfill 중단:', e);
      }
      chrome.runtime.sendMessage({ type: 'AUTO_BACKFILL_EXHAUSTED' });
    }
  },
});
