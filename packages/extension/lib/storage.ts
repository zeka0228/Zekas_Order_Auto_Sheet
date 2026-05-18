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
