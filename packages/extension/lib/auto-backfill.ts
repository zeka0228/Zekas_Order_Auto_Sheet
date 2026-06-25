/**
 * 자동 백필 탭의 플래닝·재시도 스케줄 (§1.9 후속 — background 탭 자동 열기).
 *
 * background가 "어떤 탭을 열지(planAutoTabs)"와 "tier-3 알람을 더 돌릴지(evaluateRetry)"를
 * 순수 함수로 결정하게 떼어낸다 — chrome.tabs/alarms 부수효과는 background가, 판단은 여기서.
 * now·상태를 주입받아 메모리만으로 단위 테스트 가능.
 */
import { buildGmailSearchQuery } from './gmail-search';
import { mainDomainLabel } from './order-email';
import { CANDIDATE_TTL_MS } from './storage';
import type { PendingOrder, RetryState } from './schemas';

/** 한 번에 열 자동 백필 탭 하나의 계획(도메인 라벨로 묶인 미확정 후보들). */
export interface AutoTabPlan {
  /** 도메인 라벨(예: "asobistore"). 탭 레지스트리·알람명 키. */
  groupId: string;
  /** 탭이 열 Gmail 검색 쿼리. */
  query: string;
  /** 이 탭이 백필할 후보 주문 id들. */
  orderIds: string[];
}

/**
 * 미확정 후보(orderNumber 빈 것)를 도메인 라벨로 그룹핑해 열 탭 계획을 만든다.
 * 라벨을 못 뽑는 후보(빈 라벨)는 검색 쿼리를 만들 수 없으므로 제외한다(수동 폴백).
 * 같은 판매처의 여러 후보는 한 탭/한 검색으로 묶고, 정확한 후보 매칭은 메일 열람 후
 * backfillFromOpenEmail에 맡긴다.
 */
export function planAutoTabs(pending: PendingOrder[]): AutoTabPlan[] {
  const byGroup = new Map<string, AutoTabPlan>();
  for (const o of pending) {
    if (o.orderNumber) continue;
    const groupId = mainDomainLabel(o.domain);
    if (!groupId) continue;
    const query = buildGmailSearchQuery(o.domain);
    if (!query) continue;
    const plan = byGroup.get(groupId);
    if (plan) plan.orderIds.push(o.id);
    else byGroup.set(groupId, { groupId, query, orderIds: [o.id] });
  }
  return [...byGroup.values()];
}

/** tier-3 재시도 정책 파라미터. */
export interface RetryConfig {
  /** 알람 간격(ms). chrome.alarms 최소 클램프(~30s~1분)보다 커야 함. */
  intervalMs: number;
  /** 최대 알람 재시도 횟수(=탭 재오픈 횟수). */
  maxAttempts: number;
  /** 첫 알람 이후 이 시간을 넘기면 포기(후보 TTL과 정렬). */
  ttlMs: number;
}

/** 기본 정책: 2분 간격, 최대 3회, 24h(candidate TTL) 안에서만. */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  intervalMs: 2 * 60_000,
  maxAttempts: 3,
  ttlMs: CANDIDATE_TTL_MS,
};

export type RetryAction = 'done' | 'giveup' | 'retry';

/**
 * 알람 발화 시 다음 행동을 정한다.
 *   - 대상이 모두 채워졌으면(수동 입력 또는 이전 재시도 성공) 'done'.
 *   - 최대 횟수 소진 또는 TTL 초과면 'giveup'.
 *   - 그 외 'retry' (+ 다음 알람 시각 nextAtMs).
 * stillMissingIds는 호출측이 최신 pending에서 계산해 넘긴다(알람 사이 prune·수동입력 반영).
 */
export function evaluateRetry(
  state: RetryState,
  stillMissingIds: string[],
  now: number,
  cfg: RetryConfig = DEFAULT_RETRY_CONFIG,
): { action: RetryAction; nextAtMs?: number } {
  if (stillMissingIds.length === 0) return { action: 'done' };
  if (now - state.firstScheduledAt >= cfg.ttlMs) return { action: 'giveup' };
  if (state.attempts >= cfg.maxAttempts) return { action: 'giveup' };
  return { action: 'retry', nextAtMs: now + cfg.intervalMs };
}

/** 알람명 ↔ groupId 라운드트립. */
export const ALARM_PREFIX = 'autobackfill:';
/** orphan 탭 sweep용 주기 알람명(groupId 알람과 구분). */
export const SWEEP_ALARM = 'autobackfill_sweep';

export function alarmNameFor(groupId: string): string {
  return `${ALARM_PREFIX}${groupId}`;
}

export function groupIdFromAlarm(name: string): string | null {
  return name.startsWith(ALARM_PREFIX) ? name.slice(ALARM_PREFIX.length) : null;
}
