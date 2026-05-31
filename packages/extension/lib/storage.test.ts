import { describe, expect, it } from 'vitest';
import { CANDIDATE_TTL_MS, listPendingOrders, prunePendingOrders } from './storage';
import type { PendingOrder } from './schemas';

/** chrome.storage.StorageArea 페이크 — set 호출 횟수도 센다(불필요한 쓰기 회피 검증용). */
function fakeArea(initial: PendingOrder[] = []): chrome.storage.StorageArea & {
  store: Record<string, unknown>;
  setCalls: number;
} {
  const store: Record<string, unknown> = { pending_orders: initial };
  const self = {
    store,
    setCalls: 0,
    async get(key: string) {
      return key in store ? { [key]: store[key] } : {};
    },
    async set(items: Record<string, unknown>) {
      self.setCalls += 1;
      Object.assign(store, items);
    },
    async remove(key: string) {
      delete store[key];
    },
  };
  return self as unknown as chrome.storage.StorageArea & {
    store: Record<string, unknown>;
    setCalls: number;
  };
}

const order = (overrides: Partial<PendingOrder> = {}): PendingOrder => ({
  id: 'o1',
  domain: 'shop.asobistore.jp',
  url: 'https://shop.asobistore.jp/checkout',
  capturedAt: 1000,
  source: 'checkout',
  needsHumanReview: false,
  ...overrides,
});

function ordersIn(area: { store: Record<string, unknown> }): PendingOrder[] {
  return area.store.pending_orders as PendingOrder[];
}

describe('prunePendingOrders — candidate TTL 청소 (§1.9)', () => {
  it('TTL 초과 미확정 후보(orderNumber 없음)를 제거', async () => {
    const area = fakeArea([order({ id: 'old', capturedAt: 0 })]);
    const removed = await prunePendingOrders(CANDIDATE_TTL_MS + 1, CANDIDATE_TTL_MS, area);
    expect(removed).toBe(1);
    expect(ordersIn(area)).toHaveLength(0);
  });

  it('TTL 이내 후보는 보존', async () => {
    const area = fakeArea([order({ id: 'fresh', capturedAt: 1000 })]);
    const removed = await prunePendingOrders(1000 + CANDIDATE_TTL_MS, CANDIDATE_TTL_MS, area);
    expect(removed).toBe(0);
    expect(ordersIn(area)).toHaveLength(1);
  });

  it('확정 주문(orderNumber 있음)은 아무리 오래돼도 보존', async () => {
    const area = fakeArea([order({ id: 'confirmed', capturedAt: 0, orderNumber: 'A-1' })]);
    const removed = await prunePendingOrders(CANDIDATE_TTL_MS * 100, CANDIDATE_TTL_MS, area);
    expect(removed).toBe(0);
    expect(ordersIn(area)).toHaveLength(1);
  });

  it('경계: 정확히 TTL이면 보존, 1ms 초과면 제거', async () => {
    const atBoundary = fakeArea([order({ capturedAt: 0 })]);
    expect(await prunePendingOrders(CANDIDATE_TTL_MS, CANDIDATE_TTL_MS, atBoundary)).toBe(0);

    const justOver = fakeArea([order({ capturedAt: 0 })]);
    expect(await prunePendingOrders(CANDIDATE_TTL_MS + 1, CANDIDATE_TTL_MS, justOver)).toBe(1);
  });

  it('혼합: 만료 후보만 골라 제거하고 신선·확정은 남긴다', async () => {
    const area = fakeArea([
      order({ id: 'stale', capturedAt: 0 }),
      order({ id: 'fresh', capturedAt: CANDIDATE_TTL_MS }),
      order({ id: 'confirmed', capturedAt: 0, orderNumber: 'A-1' }),
    ]);
    const removed = await prunePendingOrders(CANDIDATE_TTL_MS + 1, CANDIDATE_TTL_MS, area);
    expect(removed).toBe(1);
    expect(ordersIn(area).map((o) => o.id).sort()).toEqual(['confirmed', 'fresh']);
  });

  it('제거할 게 없으면 storage.set을 호출하지 않는다(불필요한 쓰기 회피)', async () => {
    const area = fakeArea([order({ id: 'fresh', capturedAt: 1000 })]);
    await prunePendingOrders(2000, CANDIDATE_TTL_MS, area);
    expect(area.setCalls).toBe(0);
  });

  it('빈 저장소는 0 반환·set 없음', async () => {
    const area = fakeArea([]);
    expect(await prunePendingOrders(Date.now(), CANDIDATE_TTL_MS, area)).toBe(0);
    expect(area.setCalls).toBe(0);
  });

  it('기본 TTL은 7일', () => {
    expect(CANDIDATE_TTL_MS).toBe(7 * 24 * 60 * 60_000);
  });
});

describe('listPendingOrders — area 주입 + 검증', () => {
  it('주입한 area에서 유효 주문만 파싱해 반환', async () => {
    const area = fakeArea([order({ id: 'valid' })]);
    // 손상된 항목 끼워넣기 — safeParse가 걸러야 함
    (area.store.pending_orders as unknown[]).push({ bogus: true });
    const got = await listPendingOrders(area);
    expect(got).toHaveLength(1);
    expect(got[0]?.id).toBe('valid');
  });
});
