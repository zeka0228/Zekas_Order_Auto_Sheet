import { saveCartSnapshot, type CartHtmlSnapshot } from '../lib/cart-html-snapshot';
import {
  DEFAULT_RETRY_CONFIG,
  SWEEP_ALARM,
  alarmNameFor,
  evaluateRetry,
  groupIdFromAlarm,
  planAutoTabs,
} from '../lib/auto-backfill';
import { buildGmailSearchUrl } from '../lib/gmail-search';
import {
  type AutoTabEntry,
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

/** 자동 백필 탭이 응답 없이 떠 있을 수 있는 최대 시간(orphan sweep 기준). */
const AUTO_TAB_MAX_LIFETIME_MS = 60_000;
/** tier-3 알람 간격(분) — chrome.alarms 최소 클램프(~30s~1분)보다 크게. */
const RETRY_DELAY_MINUTES = DEFAULT_RETRY_CONFIG.intervalMs / 60_000;

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

// ── 자동 백필 탭 오케스트레이션 (§1.9 후속 — background 탭 자동 열기) ──────────
// 아래 헬퍼들은 모두 enqueueWrite 큐 *안에서* 호출된다(직렬화 보장). 직접 enqueueWrite 금지.

/** 한 그룹(판매처)의 자동 백필 탭을 연다 — 이미 열린 탭이 있으면 skip. */
async function openAutoTabForGroup(
  groupId: string,
  query: string,
  orderIds: string[],
): Promise<void> {
  const tabs = await getAutoTabs();
  if (tabs.some((t) => t.groupId === groupId && t.tabId !== undefined)) return;
  const now = Date.now();
  // 센티넬 먼저 기록(tabId 없음) → create 도중 SW가 죽어도 content script가 query로 폴백 매칭 가능.
  await putAutoTab({ groupId, orderIds, query, openedAt: now });
  const tab = await chrome.tabs.create({ url: buildGmailSearchUrl(query), active: false });
  if (tab.id !== undefined) {
    await putAutoTab({ groupId, orderIds, query, openedAt: now, tabId: tab.id });
  }
}

/** 설정 ON + 미백필 후보가 있을 때만, 판매처별로 자동 백필 탭을 연다(결제 직후 tier-1). */
async function maybeOpenAutoTabs(): Promise<void> {
  const settings = await getSettings();
  if (!settings.gmailOrderEmails) return;
  const plans = planAutoTabs(await listPendingOrders());
  for (const plan of plans) {
    await openAutoTabForGroup(plan.groupId, plan.query, plan.orderIds);
  }
}

/** 레지스트리에서 빼고 실제 탭도 닫는다(best-effort). */
async function closeAndForget(tabId: number): Promise<void> {
  await removeAutoTabByTabId(tabId);
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    /* 이미 닫혔거나 사용자가 닫음 — 무해 */
  }
}

/** orderIds 중 아직 orderNumber가 빈(=미백필) 것만 추린다. */
function stillMissingOf(orderIds: string[], pending: PendingOrder[]): string[] {
  return orderIds.filter((id) => {
    const o = pending.find((p) => p.id === id);
    return o !== undefined && !o.orderNumber;
  });
}

/** tier-1/2 성공: 탭 닫고 그룹의 tier-3 상태·알람을 정리. */
async function handleAutoDone(tabId: number): Promise<void> {
  const entry = await findAutoTabByTabId(tabId);
  await closeAndForget(tabId);
  if (!entry) return;
  await clearRetryState(entry.groupId);
  await chrome.alarms.clear(alarmNameFor(entry.groupId));
}

/** tier-1/2 소진: 탭 닫고, 여전히 미백필이면 tier-3(알람) 시작(이미 진행 중이면 유지). */
async function handleAutoExhausted(tabId: number): Promise<void> {
  const entry = await findAutoTabByTabId(tabId);
  await closeAndForget(tabId);
  if (!entry) return;
  const settings = await getSettings();
  if (!settings.gmailOrderEmails) return;

  const missing = stillMissingOf(entry.orderIds, await listPendingOrders());
  if (missing.length === 0) return;

  const states = await getRetryStates();
  if (states.some((s) => s.groupId === entry.groupId)) return; // 이미 tier-3 진행 중

  await setRetryState({
    groupId: entry.groupId,
    orderIds: missing,
    query: entry.query,
    attempts: 0,
    firstScheduledAt: Date.now(),
  });
  await chrome.alarms.create(alarmNameFor(entry.groupId), { delayInMinutes: RETRY_DELAY_MINUTES });
}

/** tier-3 알람 발화: 상태·후보 재평가 후 재시도(탭 재오픈)하거나 포기. */
async function handleRetryAlarm(groupId: string): Promise<void> {
  const state = (await getRetryStates()).find((s) => s.groupId === groupId);
  if (!state) {
    await chrome.alarms.clear(alarmNameFor(groupId));
    return;
  }
  const missing = stillMissingOf(state.orderIds, await listPendingOrders());
  const decision = evaluateRetry(state, missing, Date.now());
  if (decision.action !== 'retry') {
    await clearRetryState(groupId);
    await chrome.alarms.clear(alarmNameFor(groupId));
    return;
  }
  await openAutoTabForGroup(groupId, state.query, missing);
  await setRetryState({ ...state, orderIds: missing, attempts: state.attempts + 1 });
  await chrome.alarms.create(alarmNameFor(groupId), { delayInMinutes: RETRY_DELAY_MINUTES });
}

/** maxLifetime 초과 orphan 탭(미로그인·미응답)을 닫고 레지스트리에서 청소(주기 sweep). */
async function sweepOrphanTabs(): Promise<void> {
  const stale: AutoTabEntry[] = await pruneAutoTabs(Date.now(), AUTO_TAB_MAX_LIFETIME_MS);
  for (const e of stale) {
    if (e.tabId === undefined) continue;
    try {
      await chrome.tabs.remove(e.tabId);
    } catch {
      /* 이미 닫힘 */
    }
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
      void sweepOrphanTabs();
      return;
    }
    const groupId = groupIdFromAlarm(alarm.name);
    if (groupId) enqueueWrite(() => handleRetryAlarm(groupId));
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
            .then(() => maybeOpenAutoTabs()),
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
          let entry = await findAutoTabByTabId(tabId);
          // SW 사망 윈도우: tabId 미부착 센티넬을 검색 쿼리로 폴백 매칭하고 tabId를 부착.
          if (!entry && msg.query) {
            const sentinel = await findAutoTabByQuery(msg.query);
            if (sentinel) {
              entry = { ...sentinel, tabId };
              enqueueWrite(() => putAutoTab(entry as AutoTabEntry));
            }
          }
          sendResponse(
            entry ? { auto: true, orderIds: entry.orderIds, query: entry.query } : { auto: false },
          );
        })();
        return true; // 비동기 응답
      }
      case 'AUTO_BACKFILL_DONE': {
        const tabId = sender.tab?.id;
        if (tabId !== undefined) enqueueWrite(() => handleAutoDone(tabId));
        return false;
      }
      case 'AUTO_BACKFILL_EXHAUSTED': {
        const tabId = sender.tab?.id;
        if (tabId !== undefined) enqueueWrite(() => handleAutoExhausted(tabId));
        return false;
      }
      default:
        return false;
    }
  });
});
