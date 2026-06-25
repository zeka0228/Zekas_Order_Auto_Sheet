import { describe, expect, it } from 'vitest';
import {
  RETRY_DELAY_MINUTES,
  handleAutoDone,
  handleAutoExhausted,
  handleRetryAlarm,
  maybeOpenAutoTabs,
  openAutoTabForGroup,
  resolveAutoTabReady,
  sweepOrphanTabs,
  type AutoBackfillDeps,
} from './auto-backfill-orchestrator';
import { alarmNameFor } from './auto-backfill';
import type { AutoTabEntry, PendingOrder, RetryState } from './schemas';

const order = (o: Partial<PendingOrder> = {}): PendingOrder => ({
  id: 'o1',
  domain: 'shop.asobistore.jp',
  url: 'https://shop.asobistore.jp/checkout',
  capturedAt: 1000,
  source: 'checkout',
  needsHumanReview: false,
  ...o,
});

/** in-memory 가짜 deps + 부수효과 기록(통합 검증용). */
function harness(init: { now?: number; gmailEnabled?: boolean; pending?: PendingOrder[] } = {}) {
  const h = {
    now: init.now ?? 1000,
    gmailEnabled: init.gmailEnabled ?? true,
    pending: init.pending ?? ([] as PendingOrder[]),
    autoTabs: [] as AutoTabEntry[],
    retryStates: [] as RetryState[],
    nextTabId: 100,
    created: [] as { url: string; tabId: number }[],
    removedTabs: [] as number[],
    alarms: new Map<string, number>(),
    clearedAlarms: [] as string[],
  };
  const deps: AutoBackfillDeps = {
    now: () => h.now,
    isGmailEnabled: async () => h.gmailEnabled,
    listPending: async () => h.pending,
    getAutoTabs: async () => h.autoTabs,
    putAutoTab: async (e) => {
      h.autoTabs = [...h.autoTabs.filter((x) => x.groupId !== e.groupId), e];
    },
    findAutoTabByTabId: async (id) => h.autoTabs.find((e) => e.tabId === id),
    findAutoTabByQuery: async (q) =>
      h.autoTabs.find((e) => e.tabId === undefined && e.query === q),
    removeAutoTabByTabId: async (id) => {
      h.autoTabs = h.autoTabs.filter((e) => e.tabId !== id);
    },
    pruneAutoTabs: async (now, maxAge) => {
      const stale = h.autoTabs.filter((e) => now - e.openedAt > maxAge);
      h.autoTabs = h.autoTabs.filter((e) => now - e.openedAt <= maxAge);
      return stale;
    },
    getRetryStates: async () => h.retryStates,
    setRetryState: async (s) => {
      h.retryStates = [...h.retryStates.filter((x) => x.groupId !== s.groupId), s];
    },
    clearRetryState: async (g) => {
      h.retryStates = h.retryStates.filter((x) => x.groupId !== g);
    },
    createTab: async (url) => {
      const tabId = h.nextTabId++;
      h.created.push({ url, tabId });
      return tabId;
    },
    removeTab: async (id) => {
      h.removedTabs.push(id);
    },
    createAlarm: async (name, delay) => {
      h.alarms.set(name, delay);
    },
    clearAlarm: async (name) => {
      h.clearedAlarms.push(name);
      h.alarms.delete(name);
    },
  };
  return { h, deps };
}

describe('maybeOpenAutoTabs — 결제 직후 탭 열기(tier-1)', () => {
  it('설정 ON + 미백필 후보 → 판매처 검색 URL로 백그라운드 탭 1개', async () => {
    const { h, deps } = harness({ pending: [order({ id: 'a' })] });
    await maybeOpenAutoTabs(deps);
    expect(h.created).toHaveLength(1);
    expect(h.created[0]?.url).toBe(
      'https://mail.google.com/mail/u/0/#search/from%3Aasobistore%20newer_than%3A1d',
    );
    // 레지스트리에 tabId 부착된 항목.
    expect(h.autoTabs).toHaveLength(1);
    expect(h.autoTabs[0]?.tabId).toBe(h.created[0]?.tabId);
    expect(h.autoTabs[0]?.orderIds).toEqual(['a']);
  });

  it('설정 OFF면 탭을 열지 않는다', async () => {
    const { h, deps } = harness({ gmailEnabled: false, pending: [order()] });
    await maybeOpenAutoTabs(deps);
    expect(h.created).toEqual([]);
  });

  it('이미 채워진 후보뿐이면 탭 없음', async () => {
    const { h, deps } = harness({ pending: [order({ orderNumber: 'X-1' })] });
    await maybeOpenAutoTabs(deps);
    expect(h.created).toEqual([]);
  });

  it('같은 판매처는 한 탭으로 묶는다(중복 안 엶)', async () => {
    const { h, deps } = harness({
      pending: [order({ id: 'a' }), order({ id: 'b', domain: 'www.asobistore.jp' })],
    });
    await maybeOpenAutoTabs(deps);
    expect(h.created).toHaveLength(1);
    expect(h.autoTabs[0]?.orderIds.sort()).toEqual(['a', 'b']);
  });
});

describe('openAutoTabForGroup — 중복 방지', () => {
  it('이미 열린(tabId 부착) 탭이 있으면 다시 열지 않는다', async () => {
    const { h, deps } = harness();
    await openAutoTabForGroup(deps, 'asobistore', 'q', ['a']);
    await openAutoTabForGroup(deps, 'asobistore', 'q', ['a']);
    expect(h.created).toHaveLength(1);
  });
});

describe('resolveAutoTabReady — 핸드셰이크', () => {
  it('tabId로 auto 탭이면 orderIds·query 응답', async () => {
    const { h, deps } = harness({ pending: [order({ id: 'a' })] });
    await maybeOpenAutoTabs(deps);
    const tabId = h.created[0]!.tabId;
    const { response, attach } = await resolveAutoTabReady(deps, tabId, undefined);
    expect(response).toEqual({
      auto: true,
      orderIds: ['a'],
      query: 'from:asobistore newer_than:1d',
    });
    expect(attach).toBeUndefined();
  });

  it('tabId 미부착 센티넬은 query로 폴백 매칭 + tabId 부착 지시', async () => {
    const { deps } = harness();
    await deps.putAutoTab({ groupId: 'g', orderIds: ['a'], query: 'q', openedAt: 0 }); // 센티넬
    const { response, attach } = await resolveAutoTabReady(deps, 999, 'q');
    expect(response).toEqual({ auto: true, orderIds: ['a'], query: 'q' });
    expect(attach?.tabId).toBe(999);
  });

  it('레지스트리에 없으면 auto:false(일반 Gmail 탭)', async () => {
    const { deps } = harness();
    expect((await resolveAutoTabReady(deps, 1, 'nope')).response).toEqual({ auto: false });
  });
});

describe('handleAutoDone — tier-1/2 성공', () => {
  it('탭 닫고 그룹의 retry 상태·알람 정리', async () => {
    const { h, deps } = harness({ pending: [order({ id: 'a' })] });
    await maybeOpenAutoTabs(deps);
    const tabId = h.created[0]!.tabId;
    h.retryStates = [
      { groupId: 'asobistore', orderIds: ['a'], query: 'q', attempts: 1, firstScheduledAt: 0 },
    ];
    await handleAutoDone(deps, tabId);
    expect(h.removedTabs).toContain(tabId);
    expect(h.autoTabs).toEqual([]);
    expect(h.retryStates).toEqual([]);
    expect(h.clearedAlarms).toContain(alarmNameFor('asobistore'));
  });
});

describe('handleAutoExhausted — tier-1/2 소진 → tier-3 시작', () => {
  it('여전히 미백필이면 retry 상태 + 2분 알람', async () => {
    const { h, deps } = harness({ pending: [order({ id: 'a' })] });
    await maybeOpenAutoTabs(deps);
    const tabId = h.created[0]!.tabId;
    await handleAutoExhausted(deps, tabId);
    expect(h.removedTabs).toContain(tabId);
    expect(h.retryStates[0]).toMatchObject({ groupId: 'asobistore', orderIds: ['a'], attempts: 0 });
    expect(h.alarms.get(alarmNameFor('asobistore'))).toBe(RETRY_DELAY_MINUTES);
  });

  it('소진 사이 채워졌으면 tier-3 시작 안 함', async () => {
    const { h, deps } = harness({ pending: [order({ id: 'a' })] });
    await maybeOpenAutoTabs(deps);
    const tabId = h.created[0]!.tabId;
    h.pending = [order({ id: 'a', orderNumber: 'X-1' })]; // 수동 입력 등으로 채워짐
    await handleAutoExhausted(deps, tabId);
    expect(h.retryStates).toEqual([]);
    expect(h.alarms.size).toBe(0);
  });

  it('이미 tier-3 진행 중이면 중복 시작 안 함', async () => {
    const { h, deps } = harness({ pending: [order({ id: 'a' })] });
    await maybeOpenAutoTabs(deps);
    const tabId = h.created[0]!.tabId;
    h.retryStates = [
      { groupId: 'asobistore', orderIds: ['a'], query: 'q', attempts: 2, firstScheduledAt: 0 },
    ];
    await handleAutoExhausted(deps, tabId);
    expect(h.retryStates[0]?.attempts).toBe(2); // 변경 없음
    expect(h.alarms.size).toBe(0);
  });
});

describe('handleRetryAlarm — tier-3 발화', () => {
  const retry = (o: Partial<RetryState> = {}): RetryState => ({
    groupId: 'asobistore',
    orderIds: ['a'],
    query: 'from:asobistore newer_than:1d',
    attempts: 1,
    firstScheduledAt: 0,
    ...o,
  });

  it('미백필 + 횟수·TTL 여유 → 탭 재오픈 + attempts++ + 다음 알람', async () => {
    const { h, deps } = harness({ now: 5000, pending: [order({ id: 'a' })] });
    h.retryStates = [retry({ attempts: 1 })];
    await handleRetryAlarm(deps, 'asobistore');
    expect(h.created).toHaveLength(1); // 재오픈
    expect(h.retryStates[0]?.attempts).toBe(2);
    expect(h.alarms.get(alarmNameFor('asobistore'))).toBe(RETRY_DELAY_MINUTES);
  });

  it('최대 횟수 소진 → 상태·알람 정리, 재오픈 없음', async () => {
    const { h, deps } = harness({ now: 5000, pending: [order({ id: 'a' })] });
    h.retryStates = [retry({ attempts: 3 })];
    await handleRetryAlarm(deps, 'asobistore');
    expect(h.created).toEqual([]);
    expect(h.retryStates).toEqual([]);
    expect(h.clearedAlarms).toContain(alarmNameFor('asobistore'));
  });

  it('이미 채워졌으면 정리만(재오픈 없음)', async () => {
    const { h, deps } = harness({ now: 5000, pending: [order({ id: 'a', orderNumber: 'X-1' })] });
    h.retryStates = [retry({ attempts: 1 })];
    await handleRetryAlarm(deps, 'asobistore');
    expect(h.created).toEqual([]);
    expect(h.retryStates).toEqual([]);
  });

  it('상태가 없으면 알람만 정리', async () => {
    const { h, deps } = harness();
    await handleRetryAlarm(deps, 'ghost');
    expect(h.clearedAlarms).toContain(alarmNameFor('ghost'));
  });
});

describe('sweepOrphanTabs — orphan 청소', () => {
  it('maxLifetime 초과 탭만 닫고 레지스트리에서 제거', async () => {
    const { h, deps } = harness({ now: 100_000 });
    await deps.putAutoTab({ groupId: 'old', orderIds: ['a'], query: 'q', openedAt: 0, tabId: 1 });
    await deps.putAutoTab({ groupId: 'new', orderIds: ['b'], query: 'q', openedAt: 99_000, tabId: 2 });
    await sweepOrphanTabs(deps);
    expect(h.removedTabs).toEqual([1]);
    expect(h.autoTabs.map((e) => e.groupId)).toEqual(['new']);
  });
});
