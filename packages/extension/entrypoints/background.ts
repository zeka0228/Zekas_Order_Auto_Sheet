import { saveCartSnapshot, type CartHtmlSnapshot } from '../lib/cart-html-snapshot';
import { SWEEP_ALARM, groupIdFromAlarm } from '../lib/auto-backfill';
import {
  type AutoBackfillDeps,
  handleAutoDone,
  handleAutoExhausted,
  handleRetryAlarm,
  maybeOpenAutoTabs,
  resolveAutoTabReady,
  sweepOrphanTabs,
} from '../lib/auto-backfill-orchestrator';
import {
  backfillOrderNumber,
  clearRetryState,
  countMissingOrderNumber,
  findAutoTabByQuery,
  findAutoTabByTabId,
  getAutoTabs,
  getRetryStates,
  getSettings,
  listPendingOrders,
  prunePendingOrders,
  pruneAutoTabs,
  putAutoTab,
  removeAutoTabByTabId,
  savePendingOrder,
  setOrderNumber,
  setRetryState,
} from '../lib/storage';
import type { PendingOrder } from '../lib/schemas';

/**
 * 메시지 페이로드 타입.
 * content script → background로 흐른다. 대부분 fire-and-forget(background 응답 없음)이나,
 * AUTO_TAB_READY만 "이 탭이 auto 백필 탭인지" 응답이 필요하다.
 * pending_orders·자동백필 상태 쓰기는 background 단일 주체로 모아 동시 RMW race를 피한다.
 */
type RuntimeMessage =
  | { type: 'PING' }
  | { type: 'CART_HTML_SNAPSHOT'; payload: CartHtmlSnapshot }
  | { type: 'PENDING_ORDER'; payload: PendingOrder }
  | { type: 'ORDER_BACKFILL'; payload: { orderId: string; orderNumber: string } }
  | { type: 'ORDER_SET_NUMBER'; payload: { orderId: string; orderNumber: string } }
  // 자동 백필 탭(§1.9 후속): content script가 시작 시 자신이 auto 탭인지 묻고(응답 필요),
  // tier-1/2 결과를 알린다(성공 DONE / 15초 소진 EXHAUSTED).
  | { type: 'AUTO_TAB_READY'; query?: string }
  | { type: 'AUTO_BACKFILL_DONE' }
  | { type: 'AUTO_BACKFILL_EXHAUSTED' };

/**
 * pending_orders와 자동백필 상태(retry·tab 레지스트리)는 여러 메시지·알람·청소가 read-modify-write
 * 하므로, 모든 변경을 하나의 직렬 큐에 모아 인터리빙 race를 차단한다 — "background 단일 쓰기 주체"
 * 불변식을 실제로 보장. task 실패는 삼키되 로그만 남겨 큐가 끊기지 않게 한다.
 * (큐 안에서 호출되는 헬퍼는 enqueueWrite를 다시 부르지 않는다 — 중첩 금지.)
 */
let writeChain: Promise<unknown> = Promise.resolve();
function enqueueWrite(task: () => Promise<unknown>): void {
  writeChain = writeChain.then(task).catch((e) => {
    console.error('[ZOAS] serialized write failed:', e);
  });
}

/**
 * 오케스트레이터(lib/auto-backfill-orchestrator)에 주입할 부수효과·상태 접근 묶음.
 * 실제 chrome.* + storage 헬퍼로 채운다(테스트는 in-memory 가짜로 대체).
 */
const deps: AutoBackfillDeps = {
  now: () => Date.now(),
  isGmailEnabled: async () => (await getSettings()).gmailOrderEmails,
  listPending: () => listPendingOrders(),
  getAutoTabs: () => getAutoTabs(),
  putAutoTab: (e) => putAutoTab(e),
  findAutoTabByTabId: (id) => findAutoTabByTabId(id),
  findAutoTabByQuery: (q) => findAutoTabByQuery(q),
  removeAutoTabByTabId: (id) => removeAutoTabByTabId(id),
  pruneAutoTabs: (now, maxAge) => pruneAutoTabs(now, maxAge),
  getRetryStates: () => getRetryStates(),
  setRetryState: (s) => setRetryState(s),
  clearRetryState: (g) => clearRetryState(g),
  createTab: async (url) => (await chrome.tabs.create({ url, active: false })).id,
  removeTab: async (id) => {
    await chrome.tabs.remove(id);
  },
  createAlarm: async (name, delayMinutes) => {
    await chrome.alarms.create(name, { delayInMinutes: delayMinutes });
  },
  clearAlarm: async (name) => {
    await chrome.alarms.clear(name);
  },
};

/**
 * 툴바 아이콘 배지에 "주문번호 미입력 후보 수"를 빨간 배지로 띄운다(§1.9 후속 — 수동 입력 유도).
 * pending_orders 변경 때마다 갱신해 메일 백필로 채워지면 자동으로 줄고, 0이면 배지를 지운다.
 * best-effort라 실패는 삼킨다(배지는 부가 안내일 뿐 데이터 정합성과 무관).
 */
async function refreshBadge(): Promise<void> {
  try {
    const missing = countMissingOrderNumber(await listPendingOrders());
    await chrome.action.setBadgeText({ text: missing > 0 ? String(missing) : '' });
    if (missing > 0) {
      await chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
    }
  } catch (e) {
    console.error('[ZOAS] badge refresh failed:', e);
  }
}

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener((details) => {
    console.log('[ZOAS] installed:', details.reason);
    enqueueWrite(() => prunePendingOrders().then(refreshBadge)); // 설치·업데이트 시 stale 후보 청소
    chrome.alarms.create(SWEEP_ALARM, { periodInMinutes: 1 }); // orphan 탭 주기 청소
    // 첫 설치 시 온보딩(배송대행 메일을 Gmail로 받는지) 질문을 위해 옵션 페이지를 연다.
    if (details.reason === 'install') {
      chrome.runtime.openOptionsPage();
    }
  });

  // 브라우저(프로필) 시작 시에도 청소 — 장기 미확정 후보가 무기한 쌓이지 않게(§1.9 candidate 정리).
  chrome.runtime.onStartup.addListener(() => {
    enqueueWrite(() => prunePendingOrders().then(refreshBadge));
    chrome.alarms.create(SWEEP_ALARM, { periodInMinutes: 1 });
  });

  // pending_orders가 바뀔 때마다 배지 갱신 — 저장·백필·청소·수동 입력 어느 경로든 단일 지점에서 반영.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.pending_orders) void refreshBadge();
  });

  // tier-3 재시도 알람 + orphan sweep 알람.
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SWEEP_ALARM) {
      void sweepOrphanTabs(deps);
      return;
    }
    const groupId = groupIdFromAlarm(alarm.name);
    if (groupId) enqueueWrite(() => handleRetryAlarm(deps, groupId));
  });

  // 사용자가 자동 탭을 직접 닫았을 때 레지스트리 정합(고아 항목 방지).
  chrome.tabs.onRemoved.addListener((tabId) => {
    enqueueWrite(() => removeAutoTabByTabId(tabId));
  });

  chrome.runtime.onMessage.addListener((msg: RuntimeMessage, sender, sendResponse) => {
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
        // 저장 직후 청소(stale 후보 정리)와 자동 백필 탭 열기(§1.9 후속)를 이어 붙인다.
        enqueueWrite(() =>
          savePendingOrder(msg.payload)
            .then(() => prunePendingOrders())
            .then(() => maybeOpenAutoTabs(deps)),
        );
        return false;
      case 'ORDER_BACKFILL':
        // gmail content script가 주문확인 메일에서 찾은 orderNumber를 후보 주문에 채움(§1.9).
        enqueueWrite(() => backfillOrderNumber(msg.payload.orderId, msg.payload.orderNumber));
        return false;
      case 'ORDER_SET_NUMBER':
        // popup에서 사용자가 직접 입력한 orderNumber를 후보에 설정(§1.9 후속, regex 백필 실패 시).
        // 배지·UI는 storage.onChanged로 자동 갱신되므로 여기선 쓰기만 큐에 넣는다.
        enqueueWrite(() => setOrderNumber(msg.payload.orderId, msg.payload.orderNumber));
        return false;
      case 'AUTO_TAB_READY': {
        // content script가 자신이 자동 백필 탭인지 묻는다 → sender.tab.id로 레지스트리 조회해 응답.
        // 검색 식별을 URL에 못 실어(Gmail SPA) 핸드셰이크로 대상 orderId/query를 전달한다.
        const tabId = sender.tab?.id;
        if (tabId === undefined) {
          sendResponse({ auto: false });
          return false;
        }
        void (async () => {
          const { response, attach } = await resolveAutoTabReady(deps, tabId, msg.query);
          // tabId 부착은 단일 쓰기 주체(직렬 큐)로 — 응답은 즉시.
          if (attach) enqueueWrite(() => putAutoTab(attach));
          sendResponse(response);
        })();
        return true; // 비동기 응답
      }
      case 'AUTO_BACKFILL_DONE': {
        const tabId = sender.tab?.id;
        if (tabId !== undefined) enqueueWrite(() => handleAutoDone(deps, tabId));
        return false;
      }
      case 'AUTO_BACKFILL_EXHAUSTED': {
        const tabId = sender.tab?.id;
        if (tabId !== undefined) enqueueWrite(() => handleAutoExhausted(deps, tabId));
        return false;
      }
      default:
        return false;
    }
  });
});
