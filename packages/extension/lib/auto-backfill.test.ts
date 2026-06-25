import { describe, expect, it } from 'vitest';
import {
  ALARM_PREFIX,
  DEFAULT_RETRY_CONFIG,
  alarmNameFor,
  evaluateRetry,
  groupIdFromAlarm,
  planAutoTabs,
  type RetryConfig,
} from './auto-backfill';
import type { PendingOrder, RetryState } from './schemas';

const order = (overrides: Partial<PendingOrder> = {}): PendingOrder => ({
  id: 'o1',
  domain: 'shop.asobistore.jp',
  url: 'https://shop.asobistore.jp/checkout',
  capturedAt: 1000,
  source: 'checkout',
  needsHumanReview: false,
  ...overrides,
});

describe('planAutoTabs', () => {
  it('orderNumber 빈 후보만 도메인 라벨로 그룹핑', () => {
    const plans = planAutoTabs([
      order({ id: 'a', domain: 'shop.asobistore.jp' }),
      order({ id: 'b', domain: 'www.asobistore.jp' }),
      order({ id: 'c', domain: 'other.com' }),
    ]);
    const asobi = plans.find((p) => p.groupId === 'asobistore');
    expect(asobi?.orderIds.sort()).toEqual(['a', 'b']);
    expect(asobi?.query).toBe('from:asobistore newer_than:1d');
    expect(plans.find((p) => p.groupId === 'other')?.orderIds).toEqual(['c']);
  });

  it('이미 채워진(orderNumber 있는) 후보는 제외', () => {
    const plans = planAutoTabs([order({ id: 'done', orderNumber: 'X-1' })]);
    expect(plans).toEqual([]);
  });

  it('도메인 라벨을 못 뽑는 후보는 제외(검색 불가)', () => {
    const plans = planAutoTabs([order({ id: 'bad', domain: '' })]);
    expect(plans).toEqual([]);
  });
});

describe('evaluateRetry', () => {
  const state = (overrides: Partial<RetryState> = {}): RetryState => ({
    groupId: 'asobistore',
    orderIds: ['o1'],
    query: 'from:asobistore newer_than:1d',
    attempts: 0,
    firstScheduledAt: 0,
    ...overrides,
  });
  const cfg: RetryConfig = { intervalMs: 1000, maxAttempts: 3, ttlMs: 10_000 };

  it('대상이 모두 채워졌으면 done', () => {
    expect(evaluateRetry(state(), [], 500, cfg).action).toBe('done');
  });

  it('미충족이고 횟수·TTL 여유면 retry + 다음 시각', () => {
    const r = evaluateRetry(state({ attempts: 1 }), ['o1'], 500, cfg);
    expect(r.action).toBe('retry');
    expect(r.nextAtMs).toBe(1500);
  });

  it('최대 횟수 소진이면 giveup', () => {
    expect(evaluateRetry(state({ attempts: 3 }), ['o1'], 500, cfg).action).toBe('giveup');
  });

  it('TTL 초과면 giveup(횟수 남아도)', () => {
    expect(evaluateRetry(state({ attempts: 0 }), ['o1'], 10_000, cfg).action).toBe('giveup');
  });

  it('기본 정책: 2분 간격·3회·24h', () => {
    expect(DEFAULT_RETRY_CONFIG.intervalMs).toBe(2 * 60_000);
    expect(DEFAULT_RETRY_CONFIG.maxAttempts).toBe(3);
    expect(DEFAULT_RETRY_CONFIG.ttlMs).toBe(24 * 60 * 60_000);
  });
});

describe('alarmNameFor / groupIdFromAlarm', () => {
  it('라운드트립', () => {
    const name = alarmNameFor('asobistore');
    expect(name).toBe(`${ALARM_PREFIX}asobistore`);
    expect(groupIdFromAlarm(name)).toBe('asobistore');
  });

  it('prefix 불일치(예: sweep 알람)는 null', () => {
    expect(groupIdFromAlarm('autobackfill_sweep')).toBeNull();
    expect(groupIdFromAlarm('other')).toBeNull();
  });
});
