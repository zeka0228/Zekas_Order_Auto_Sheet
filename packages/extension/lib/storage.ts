import {
  PendingOrderSchema,
  SettingsSchema,
  type PendingOrder,
  type Settings,
} from './schemas';

export type { PendingOrder, Settings };

const KEY_ORDERS = 'pending_orders';
const KEY_SETTINGS = 'settings';

export async function listPendingOrders(): Promise<PendingOrder[]> {
  const raw = await chrome.storage.local.get(KEY_ORDERS);
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

export async function getSettings(): Promise<Settings> {
  const raw = await chrome.storage.local.get(KEY_SETTINGS);
  const parsed = SettingsSchema.safeParse(raw[KEY_SETTINGS] ?? {});
  return parsed.success ? parsed.data : SettingsSchema.parse({});
}

export async function saveSettings(settings: Settings): Promise<void> {
  const validated = SettingsSchema.parse(settings);
  await chrome.storage.local.set({ [KEY_SETTINGS]: validated });
}
