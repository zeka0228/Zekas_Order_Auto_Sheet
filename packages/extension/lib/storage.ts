import {
  AutoTabEntrySchema,
  PendingOrderSchema,
  RetryStateSchema,
  SettingsSchema,
  type AutoTabEntry,
  type PendingOrder,
  type RetryState,
  type Settings,
} from './schemas';

export type { AutoTabEntry, PendingOrder, RetryState, Settings };

const KEY_ORDERS = 'pending_orders';
const KEY_SETTINGS = 'settings';
/** tier-3 재시도 상태(local 영속, chrome.alarms와 수명 정렬). */
const KEY_RETRY = 'autobackfill_retry';
/** 자동 백필 탭 레지스트리(session, 브라우저 세션 동안만). */
const KEY_AUTOTABS = 'autobackfill_tabs';

type Area = chrome.storage.StorageArea;

/**
 * 미확정 후보(orderNumber 없는 candidate) TTL — 결제 클릭 후 이 기간 내 이메일 백필이 안 되면
 * 미결제·이탈로 보고 폐기한다(확정 주문은 보존). cart 스냅샷과 동일하게 24h(§1.9 MVP 결정).
 *
 * 트레이드오프(인지하고 채택): 열람-시-백필(§1.9)은 사용자가 주문확인 메일을 *열어야* 발동하므로,
 * 결제 후 24h 안에 Gmail에서 그 메일을 열지 않으면 후보가 먼저 청소돼 orderNumber 백필이 안 된다.
 * 즉 백필은 "당일 메일 확인" 사용 패턴에 묶인다. 누적·정리 단순함을 우선해 24h로 시작하고, 백필
 * 실패가 잦으면 상향 검토.
 */
export const CANDIDATE_TTL_MS = 24 * 60 * 60_000;

export async function listPendingOrders(area: Area = chrome.storage.local): Promise<PendingOrder[]> {
  const raw = await area.get(KEY_ORDERS);
  const arr = (raw[KEY_ORDERS] as unknown[] | undefined) ?? [];
  return arr
    .map((item) => PendingOrderSchema.safeParse(item))
    .filter((r) => r.success)
    .map((r) => (r as { success: true; data: PendingOrder }).data);
}

export async function savePendingOrder(order: PendingOrder): Promise<void> {
  const validated = PendingOrderSchema.parse(order);
  const existing = await listPendingOrders();
  const next = [...existing.filter((o) => o.id !== validated.id), validated];
  await chrome.storage.local.set({ [KEY_ORDERS]: next });
}

/**
 * 주문확인 이메일에서 찾은 orderNumber를 후보 주문에 채운다(§1.9 백필).
 * 대상이 없거나 이미 orderNumber가 있으면 false. needsHumanReview는 상품·가격 기준이라
 * orderNumber 백필로 바뀌지 않는다 — orderNumber만 채운다.
 */
export async function backfillOrderNumber(
  id: string,
  orderNumber: string,
): Promise<boolean> {
  const existing = await listPendingOrders();
  const target = existing.find((o) => o.id === id);
  if (!target || target.orderNumber) return false;
  const updated = PendingOrderSchema.parse({ ...target, orderNumber });
  await chrome.storage.local.set({
    [KEY_ORDERS]: existing.map((o) => (o.id === id ? updated : o)),
  });
  return true;
}

/**
 * 사용자가 직접 입력한 주문번호를 후보에 설정한다(§1.9 후속 — 제목·본문 regex 백필이 실패해
 * popup에서 수동 입력하는 경로). backfillOrderNumber와 달리 이미 값이 있어도 덮어쓴다(사용자
 * 명시 정정 허용). 입력을 trim하고, 빈 문자열이거나 대상이 없으면 false.
 *
 * background 직렬 큐에서만 호출해 read-modify-write race를 피한다(다른 쓰기와 동일 불변식).
 */
export async function setOrderNumber(
  id: string,
  orderNumber: string,
  area: Area = chrome.storage.local,
): Promise<boolean> {
  const trimmed = orderNumber.trim();
  if (!trimmed) return false;
  const existing = await listPendingOrders(area);
  const target = existing.find((o) => o.id === id);
  if (!target) return false;
  const updated = PendingOrderSchema.parse({ ...target, orderNumber: trimmed });
  await area.set({ [KEY_ORDERS]: existing.map((o) => (o.id === id ? updated : o)) });
  return true;
}

/**
 * orderNumber가 아직 비어있는(= 자동 백필 안 됐거나 추출 실패해 수동 입력이 필요한) 후보 수.
 * 툴바 아이콘 배지 숫자에 쓴다. 순수 함수라 단위 테스트로 고정.
 */
export function countMissingOrderNumber(orders: PendingOrder[]): number {
  return orders.filter((o) => !o.orderNumber).length;
}

export async function removePendingOrder(id: string): Promise<void> {
  const existing = await listPendingOrders();
  await chrome.storage.local.set({
    [KEY_ORDERS]: existing.filter((o) => o.id !== id),
  });
}

/**
 * 미확정 후보 주문을 TTL 기준으로 청소한다(§1.9 후속, candidate 정리).
 * orderNumber가 채워진 확정 주문은 나이와 무관하게 보존 — 폐기 대상은 영영 confirm 안 되는 후보뿐.
 * 변경이 있을 때만 storage.set(불필요한 쓰기 회피). 제거한 개수를 반환.
 *
 * background(단일 쓰기 주체)의 직렬 큐에서만 호출해 read-modify-write race를 피한다.
 */
export async function prunePendingOrders(
  now: number = Date.now(),
  ttlMs: number = CANDIDATE_TTL_MS,
  area: Area = chrome.storage.local,
): Promise<number> {
  const existing = await listPendingOrders(area);
  const kept = existing.filter((o) => o.orderNumber || now - o.capturedAt <= ttlMs);
  if (kept.length === existing.length) return 0;
  await area.set({ [KEY_ORDERS]: kept });
  return existing.length - kept.length;
}

export async function getSettings(): Promise<Settings> {
  const raw = await chrome.storage.local.get(KEY_SETTINGS);
  const parsed = SettingsSchema.safeParse(raw[KEY_SETTINGS] ?? {});
  return parsed.success ? parsed.data : SettingsSchema.parse({});
}

export async function saveSettings(settings: Settings): Promise<void> {
  const validated = SettingsSchema.parse(settings);
  await chrome.storage.local.set({ [KEY_SETTINGS]: validated });
}

// ── tier-3 재시도 상태 (§1.9 후속 — 자동 백필 탭) ──────────────────────────────
// background 단일 쓰기 주체에서만 호출(알람 핸들러·메시지). groupId당 한 항목.

function parseRetryStates(raw: unknown): RetryState[] {
  return ((raw as unknown[] | undefined) ?? [])
    .map((item) => RetryStateSchema.safeParse(item))
    .filter((r) => r.success)
    .map((r) => (r as { success: true; data: RetryState }).data);
}

export async function getRetryStates(area: Area = chrome.storage.local): Promise<RetryState[]> {
  const raw = await area.get(KEY_RETRY);
  return parseRetryStates(raw[KEY_RETRY]);
}

/** groupId 키로 재시도 상태를 upsert. */
export async function setRetryState(
  state: RetryState,
  area: Area = chrome.storage.local,
): Promise<void> {
  const validated = RetryStateSchema.parse(state);
  const existing = await getRetryStates(area);
  const next = [...existing.filter((s) => s.groupId !== validated.groupId), validated];
  await area.set({ [KEY_RETRY]: next });
}

/** groupId의 재시도 상태를 제거. 없으면 no-op(불필요한 쓰기 회피). */
export async function clearRetryState(
  groupId: string,
  area: Area = chrome.storage.local,
): Promise<void> {
  const existing = await getRetryStates(area);
  const next = existing.filter((s) => s.groupId !== groupId);
  if (next.length === existing.length) return;
  await area.set({ [KEY_RETRY]: next });
}

// ── 자동 백필 탭 레지스트리 (§1.9 후속) ───────────────────────────────────────
// session 영역에 저장(SW 재시작 견딤, 브라우저 종료 시 소멸). background에서만 쓴다.

function parseAutoTabs(raw: unknown): AutoTabEntry[] {
  return ((raw as unknown[] | undefined) ?? [])
    .map((item) => AutoTabEntrySchema.safeParse(item))
    .filter((r) => r.success)
    .map((r) => (r as { success: true; data: AutoTabEntry }).data);
}

export async function getAutoTabs(area: Area = chrome.storage.session): Promise<AutoTabEntry[]> {
  const raw = await area.get(KEY_AUTOTABS);
  return parseAutoTabs(raw[KEY_AUTOTABS]);
}

/** groupId 키로 레지스트리 항목을 upsert(센티넬 기록 후 tabId 부착 갱신에 같이 쓴다). */
export async function putAutoTab(
  entry: AutoTabEntry,
  area: Area = chrome.storage.session,
): Promise<void> {
  const validated = AutoTabEntrySchema.parse(entry);
  const existing = await getAutoTabs(area);
  const next = [...existing.filter((e) => e.groupId !== validated.groupId), validated];
  await area.set({ [KEY_AUTOTABS]: next });
}

export async function findAutoTabByTabId(
  tabId: number,
  area: Area = chrome.storage.session,
): Promise<AutoTabEntry | undefined> {
  return (await getAutoTabs(area)).find((e) => e.tabId === tabId);
}

/** tabId 미부착(센티넬) 항목을 검색 쿼리로 폴백 매칭 — SW 사망 윈도우의 orphan 핸드셰이크 구제용. */
export async function findAutoTabByQuery(
  query: string,
  area: Area = chrome.storage.session,
): Promise<AutoTabEntry | undefined> {
  return (await getAutoTabs(area)).find((e) => e.tabId === undefined && e.query === query);
}

/** tabId로 레지스트리 항목 제거. 없으면 no-op. */
export async function removeAutoTabByTabId(
  tabId: number,
  area: Area = chrome.storage.session,
): Promise<void> {
  const existing = await getAutoTabs(area);
  const next = existing.filter((e) => e.tabId !== tabId);
  if (next.length === existing.length) return;
  await area.set({ [KEY_AUTOTABS]: next });
}

/**
 * openedAt이 maxAgeMs를 넘긴 orphan 레지스트리 항목을 제거하고, **제거된 항목들을 반환**한다
 * (호출측 background가 그 tabId 탭을 실제로 닫게). 미응답 탭(미로그인 리다이렉트 등)·SW 사망으로
 * 남은 센티넬을 주기 sweep으로 청소. 변경 없으면 set 호출 없음.
 */
export async function pruneAutoTabs(
  now: number,
  maxAgeMs: number,
  area: Area = chrome.storage.session,
): Promise<AutoTabEntry[]> {
  const existing = await getAutoTabs(area);
  const stale = existing.filter((e) => now - e.openedAt > maxAgeMs);
  if (stale.length === 0) return [];
  await area.set({ [KEY_AUTOTABS]: existing.filter((e) => now - e.openedAt <= maxAgeMs) });
  return stale;
}
