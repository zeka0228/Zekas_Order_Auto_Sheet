import {
  PendingOrderSchema,
  SettingsSchema,
  type PendingOrder,
  type Settings,
} from './schemas';

export type { PendingOrder, Settings };

const KEY_ORDERS = 'pending_orders';
const KEY_SETTINGS = 'settings';

type Area = chrome.storage.StorageArea;

/**
 * 미확정 후보(orderNumber 없는 candidate) TTL — 결제 클릭 후 이 기간 내 이메일 백필이 안 되면
 * 미결제·이탈로 보고 폐기한다(확정 주문은 보존). cart 스냅샷(24h)보다 길게 잡는다: 열람-시-백필(§1.9)은
 * 사용자가 주문확인 메일을 *열어야* 발동하는데, 확인 메일은 분 내 도착해도 Gmail을 며칠 뒤 열 수 있어
 * 너무 짧으면 백필 전에 후보가 사라진다. 7일이면 그 사이 한 번은 메일을 열 여지가 있고, 그 뒤로도
 * 안 채워졌으면 실패·이탈로 보는 게 안전하다.
 */
export const CANDIDATE_TTL_MS = 7 * 24 * 60 * 60_000;

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
