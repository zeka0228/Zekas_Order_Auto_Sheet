import { describe, expect, it } from 'vitest';
import {
  CANDIDATE_TTL_MS,
  clearRetryState,
  countMissingOrderNumber,
  findAutoTabByQuery,
  findAutoTabByTabId,
  getAutoTabs,
  getRetryStates,
  listPendingOrders,
  prunePendingOrders,
  pruneAutoTabs,
  putAutoTab,
  removeAutoTabByTabId,
  setOrderNumber,
  setRetryState,
} from './storage';
import {
  SettingsSchema,
  type AutoTabEntry,
  type PendingOrder,
  type RetryState,
} from './schemas';

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

  it('기본 TTL은 24시간', () => {
    expect(CANDIDATE_TTL_MS).toBe(24 * 60 * 60_000);
  });
});

describe('setOrderNumber — 수동 입력 (§1.9 후속)', () => {
  it('빈 후보에 입력하면 orderNumber를 채우고 true', async () => {
    const area = fakeArea([order({ id: 'o1' })]);
    expect(await setOrderNumber('o1', 'A-123', area)).toBe(true);
    expect(ordersIn(area)[0]?.orderNumber).toBe('A-123');
  });

  it('입력값 앞뒤 공백을 trim한다', async () => {
    const area = fakeArea([order({ id: 'o1' })]);
    await setOrderNumber('o1', '  A-123  ', area);
    expect(ordersIn(area)[0]?.orderNumber).toBe('A-123');
  });

  it('이미 값이 있어도 덮어쓴다(사용자 명시 정정)', async () => {
    const area = fakeArea([order({ id: 'o1', orderNumber: 'WRONG' })]);
    expect(await setOrderNumber('o1', 'A-123', area)).toBe(true);
    expect(ordersIn(area)[0]?.orderNumber).toBe('A-123');
  });

  it('빈 문자열·공백뿐인 입력은 거부하고 false (set 없음)', async () => {
    const area = fakeArea([order({ id: 'o1' })]);
    expect(await setOrderNumber('o1', '   ', area)).toBe(false);
    expect(area.setCalls).toBe(0);
    expect(ordersIn(area)[0]?.orderNumber).toBeUndefined();
  });

  it('대상 id가 없으면 false (set 없음)', async () => {
    const area = fakeArea([order({ id: 'o1' })]);
    expect(await setOrderNumber('nope', 'A-123', area)).toBe(false);
    expect(area.setCalls).toBe(0);
  });

  it('대상만 바꾸고 다른 후보는 건드리지 않는다', async () => {
    const area = fakeArea([order({ id: 'o1' }), order({ id: 'o2' })]);
    await setOrderNumber('o2', 'A-2', area);
    expect(ordersIn(area).find((o) => o.id === 'o1')?.orderNumber).toBeUndefined();
    expect(ordersIn(area).find((o) => o.id === 'o2')?.orderNumber).toBe('A-2');
  });
});

describe('countMissingOrderNumber — 배지 카운트', () => {
  it('orderNumber 빈 후보만 센다', () => {
    expect(
      countMissingOrderNumber([
        order({ id: 'a' }),
        order({ id: 'b', orderNumber: 'X-1' }),
        order({ id: 'c' }),
      ]),
    ).toBe(2);
  });

  it('빈 문자열 orderNumber도 미입력으로 센다', () => {
    expect(countMissingOrderNumber([order({ id: 'a', orderNumber: '' })])).toBe(1);
  });

  it('빈 목록은 0', () => {
    expect(countMissingOrderNumber([])).toBe(0);
  });
});

describe('SettingsSchema — 온보딩/Gmail 기본값', () => {
  it('빈 객체 parse 시 미온보딩·Gmail 비활성(메일 e2e 안 돌림)', () => {
    const s = SettingsSchema.parse({});
    expect(s.onboarded).toBe(false);
    expect(s.gmailOrderEmails).toBe(false);
    expect(s.proEnabled).toBe(false);
  });

  it('온보딩에서 Gmail "예" 선택값을 보존', () => {
    const s = SettingsSchema.parse({ onboarded: true, gmailOrderEmails: true });
    expect(s.onboarded).toBe(true);
    expect(s.gmailOrderEmails).toBe(true);
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

/** 키가 빈 일반 fake area(retry state·auto-tab 레지스트리용). */
function emptyArea(): chrome.storage.StorageArea & {
  store: Record<string, unknown>;
  setCalls: number;
} {
  const store: Record<string, unknown> = {};
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

describe('retry state — tier-3 장기 재시도 (§1.9 후속)', () => {
  const state = (overrides: Partial<RetryState> = {}): RetryState => ({
    groupId: 'asobistore',
    orderIds: ['o1'],
    query: 'from:asobistore newer_than:1d',
    attempts: 0,
    firstScheduledAt: 0,
    ...overrides,
  });

  it('setRetryState로 upsert하고 getRetryStates로 읽는다', async () => {
    const area = emptyArea();
    await setRetryState(state(), area);
    expect(await getRetryStates(area)).toEqual([state()]);
  });

  it('같은 groupId는 덮어쓴다(중복 누적 없음)', async () => {
    const area = emptyArea();
    await setRetryState(state({ attempts: 0 }), area);
    await setRetryState(state({ attempts: 2 }), area);
    const got = await getRetryStates(area);
    expect(got).toHaveLength(1);
    expect(got[0]?.attempts).toBe(2);
  });

  it('clearRetryState로 제거, 없으면 set 호출 없음', async () => {
    const area = emptyArea();
    await setRetryState(state(), area);
    const callsBefore = area.setCalls;
    await clearRetryState('asobistore', area);
    expect(await getRetryStates(area)).toEqual([]);
    await clearRetryState('nope', area);
    expect(area.setCalls).toBe(callsBefore + 1); // 두 번째 clear는 no-op
  });
});

describe('auto-tab 레지스트리 — 자동 백필 탭 (§1.9 후속)', () => {
  const entry = (overrides: Partial<AutoTabEntry> = {}): AutoTabEntry => ({
    groupId: 'asobistore',
    tabId: 42,
    orderIds: ['o1'],
    query: 'from:asobistore newer_than:1d',
    openedAt: 1000,
    ...overrides,
  });

  it('putAutoTab 후 tabId로 조회', async () => {
    const area = emptyArea();
    await putAutoTab(entry(), area);
    expect(await findAutoTabByTabId(42, area)).toEqual(entry());
    expect(await findAutoTabByTabId(99, area)).toBeUndefined();
  });

  it('센티넬(tabId 없음)을 putAutoTab 후 tabId 부착 갱신(같은 groupId 덮어씀)', async () => {
    const area = emptyArea();
    await putAutoTab(entry({ tabId: undefined }), area);
    await putAutoTab(entry({ tabId: 7 }), area);
    expect(await getAutoTabs(area)).toHaveLength(1);
    expect(await findAutoTabByTabId(7, area)).toBeDefined();
  });

  it('findAutoTabByQuery는 tabId 미부착 센티넬만 매칭(SW 사망 윈도우 구제)', async () => {
    const area = emptyArea();
    await putAutoTab(entry({ groupId: 'g1', tabId: undefined, query: 'q1' }), area);
    await putAutoTab(entry({ groupId: 'g2', tabId: 5, query: 'q2' }), area);
    expect((await findAutoTabByQuery('q1', area))?.groupId).toBe('g1');
    expect(await findAutoTabByQuery('q2', area)).toBeUndefined(); // tabId 있으면 폴백 아님
  });

  it('removeAutoTabByTabId로 제거, 없으면 set 호출 없음', async () => {
    const area = emptyArea();
    await putAutoTab(entry(), area);
    const callsBefore = area.setCalls;
    await removeAutoTabByTabId(42, area);
    expect(await getAutoTabs(area)).toEqual([]);
    await removeAutoTabByTabId(42, area);
    expect(area.setCalls).toBe(callsBefore + 1); // 두 번째 remove는 no-op
  });

  it('pruneAutoTabs는 maxAge 초과 항목을 제거하고 그 항목들을 반환', async () => {
    const area = emptyArea();
    await putAutoTab(entry({ groupId: 'old', tabId: 1, openedAt: 0 }), area);
    await putAutoTab(entry({ groupId: 'fresh', tabId: 2, openedAt: 9000 }), area);
    const stale = await pruneAutoTabs(10_000, 5000, area); // now=10000, maxAge=5000 → old(나이10000) 제거
    expect(stale.map((e) => e.tabId)).toEqual([1]);
    expect((await getAutoTabs(area)).map((e) => e.groupId)).toEqual(['fresh']);
  });

  it('pruneAutoTabs는 제거할 게 없으면 set 호출 없음·빈 배열', async () => {
    const area = emptyArea();
    await putAutoTab(entry({ tabId: 2, openedAt: 9000 }), area);
    const callsBefore = area.setCalls;
    expect(await pruneAutoTabs(10_000, 5000, area)).toEqual([]);
    expect(area.setCalls).toBe(callsBefore);
  });
});
