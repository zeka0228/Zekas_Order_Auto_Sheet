/**
 * 자동 백필 탭 오케스트레이션 (§1.9 후속 — background 탭 자동 열기).
 *
 * background.ts에서 chrome.tabs/alarms/storage 부수효과를 떼어내 **의존성 주입형**으로 만든다
 * (gmail-backfill의 backfillOnOpenEmail와 같은 결). 그래서 in-memory 가짜로 "결제 → 탭 열림 →
 * 핸드셰이크 → 성공/소진 → tier-3 알람 → orphan 청소" 전 경로를 단위 테스트할 수 있다.
 *
 * 모든 함수는 호출측(background)의 직렬 쓰기 큐 안에서 돌아간다고 가정한다 — 여기선 큐를 모른다.
 */
import {
  DEFAULT_RETRY_CONFIG,
  alarmNameFor,
  evaluateRetry,
  planAutoTabs,
} from './auto-backfill';
import { buildGmailSearchUrl } from './gmail-search';
import type { AutoTabEntry, PendingOrder, RetryState } from './schemas';

/** 자동 탭이 응답 없이 떠 있을 수 있는 최대 시간(orphan sweep 기준). */
export const AUTO_TAB_MAX_LIFETIME_MS = 60_000;
/** tier-3 알람 간격(분) — chrome.alarms 최소 클램프(~30s~1분)보다 크게. */
export const RETRY_DELAY_MINUTES = DEFAULT_RETRY_CONFIG.intervalMs / 60_000;

/** AUTO_TAB_READY 핸드셰이크 응답. */
export type AutoTabReadyResponse =
  | { auto: true; orderIds: string[]; query: string }
  | { auto: false };

/**
 * 오케스트레이터가 쓰는 모든 부수효과·상태 접근의 주입점.
 * background는 chrome.* + storage 헬퍼로, 테스트는 in-memory 가짜로 채운다.
 */
export interface AutoBackfillDeps {
  now(): number;
  isGmailEnabled(): Promise<boolean>;
  listPending(): Promise<PendingOrder[]>;
  // auto-tab 레지스트리(session)
  getAutoTabs(): Promise<AutoTabEntry[]>;
  putAutoTab(entry: AutoTabEntry): Promise<void>;
  findAutoTabByTabId(tabId: number): Promise<AutoTabEntry | undefined>;
  findAutoTabByQuery(query: string): Promise<AutoTabEntry | undefined>;
  removeAutoTabByTabId(tabId: number): Promise<void>;
  pruneAutoTabs(now: number, maxAgeMs: number): Promise<AutoTabEntry[]>;
  // tier-3 재시도 상태(local)
  getRetryStates(): Promise<RetryState[]>;
  setRetryState(state: RetryState): Promise<void>;
  clearRetryState(groupId: string): Promise<void>;
  // 부수효과
  createTab(url: string): Promise<number | undefined>;
  removeTab(tabId: number): Promise<void>;
  createAlarm(name: string, delayMinutes: number): Promise<void>;
  clearAlarm(name: string): Promise<void>;
}

/** orderIds 중 아직 orderNumber가 빈(=미백필) 것만. */
function stillMissingOf(orderIds: string[], pending: PendingOrder[]): string[] {
  return orderIds.filter((id) => {
    const o = pending.find((p) => p.id === id);
    return o !== undefined && !o.orderNumber;
  });
}

/** 한 그룹(판매처)의 자동 백필 탭을 연다 — 이미 열린(tabId 부착) 탭이 있으면 skip. */
export async function openAutoTabForGroup(
  deps: AutoBackfillDeps,
  groupId: string,
  query: string,
  orderIds: string[],
): Promise<void> {
  const tabs = await deps.getAutoTabs();
  if (tabs.some((t) => t.groupId === groupId && t.tabId !== undefined)) return;
  const now = deps.now();
  // 센티넬 먼저 기록(tabId 없음) → create 도중 SW가 죽어도 content script가 query로 폴백 매칭 가능.
  await deps.putAutoTab({ groupId, orderIds, query, openedAt: now });
  const tabId = await deps.createTab(buildGmailSearchUrl(query));
  if (tabId !== undefined) {
    await deps.putAutoTab({ groupId, orderIds, query, openedAt: now, tabId });
  }
}

/** 설정 ON + 미백필 후보가 있을 때만, 판매처별로 자동 백필 탭을 연다(결제 직후 tier-1). */
export async function maybeOpenAutoTabs(deps: AutoBackfillDeps): Promise<void> {
  if (!(await deps.isGmailEnabled())) return;
  const plans = planAutoTabs(await deps.listPending());
  for (const plan of plans) {
    await openAutoTabForGroup(deps, plan.groupId, plan.query, plan.orderIds);
  }
}

/** 레지스트리에서 빼고 실제 탭도 닫는다(best-effort). */
async function closeAndForget(deps: AutoBackfillDeps, tabId: number): Promise<void> {
  await deps.removeAutoTabByTabId(tabId);
  try {
    await deps.removeTab(tabId);
  } catch {
    /* 이미 닫혔거나 사용자가 닫음 — 무해 */
  }
}

/** tier-1/2 성공: 탭 닫고 그룹의 tier-3 상태·알람을 정리. */
export async function handleAutoDone(deps: AutoBackfillDeps, tabId: number): Promise<void> {
  const entry = await deps.findAutoTabByTabId(tabId);
  await closeAndForget(deps, tabId);
  if (!entry) return;
  await deps.clearRetryState(entry.groupId);
  await deps.clearAlarm(alarmNameFor(entry.groupId));
}

/** tier-1/2 소진: 탭 닫고, 여전히 미백필이면 tier-3(알람) 시작(이미 진행 중이면 유지). */
export async function handleAutoExhausted(deps: AutoBackfillDeps, tabId: number): Promise<void> {
  const entry = await deps.findAutoTabByTabId(tabId);
  await closeAndForget(deps, tabId);
  if (!entry) return;
  if (!(await deps.isGmailEnabled())) return;

  const missing = stillMissingOf(entry.orderIds, await deps.listPending());
  if (missing.length === 0) return;

  const states = await deps.getRetryStates();
  if (states.some((s) => s.groupId === entry.groupId)) return; // 이미 tier-3 진행 중

  await deps.setRetryState({
    groupId: entry.groupId,
    orderIds: missing,
    query: entry.query,
    attempts: 0,
    firstScheduledAt: deps.now(),
  });
  await deps.createAlarm(alarmNameFor(entry.groupId), RETRY_DELAY_MINUTES);
}

/** tier-3 알람 발화: 상태·후보 재평가 후 재시도(탭 재오픈)하거나 포기. */
export async function handleRetryAlarm(deps: AutoBackfillDeps, groupId: string): Promise<void> {
  const state = (await deps.getRetryStates()).find((s) => s.groupId === groupId);
  if (!state) {
    await deps.clearAlarm(alarmNameFor(groupId));
    return;
  }
  const missing = stillMissingOf(state.orderIds, await deps.listPending());
  const decision = evaluateRetry(state, missing, deps.now());
  if (decision.action !== 'retry') {
    await deps.clearRetryState(groupId);
    await deps.clearAlarm(alarmNameFor(groupId));
    return;
  }
  await openAutoTabForGroup(deps, groupId, state.query, missing);
  await deps.setRetryState({ ...state, orderIds: missing, attempts: state.attempts + 1 });
  await deps.createAlarm(alarmNameFor(groupId), RETRY_DELAY_MINUTES);
}

/** maxLifetime 초과 orphan 탭(미로그인·미응답)을 닫고 레지스트리에서 청소(주기 sweep). */
export async function sweepOrphanTabs(deps: AutoBackfillDeps): Promise<void> {
  const stale = await deps.pruneAutoTabs(deps.now(), AUTO_TAB_MAX_LIFETIME_MS);
  for (const e of stale) {
    if (e.tabId === undefined) continue;
    try {
      await deps.removeTab(e.tabId);
    } catch {
      /* 이미 닫힘 */
    }
  }
}

/**
 * AUTO_TAB_READY 핸드셰이크 해석(읽기 전용). tabId로 레지스트리를 찾고, 없으면 검색 쿼리로
 * 센티넬을 폴백 매칭(SW 사망 윈도우 구제). 폴백이 맞으면 tabId를 부착할 항목을 `attach`로 돌려주고,
 * **실제 쓰기는 호출측이 직렬 큐로** 수행한다(단일 쓰기 주체 불변식 유지).
 */
export async function resolveAutoTabReady(
  deps: AutoBackfillDeps,
  tabId: number,
  query: string | undefined,
): Promise<{ response: AutoTabReadyResponse; attach?: AutoTabEntry }> {
  let entry = await deps.findAutoTabByTabId(tabId);
  let attach: AutoTabEntry | undefined;
  if (!entry && query) {
    const sentinel = await deps.findAutoTabByQuery(query);
    if (sentinel) {
      entry = { ...sentinel, tabId };
      attach = entry;
    }
  }
  return {
    response: entry
      ? { auto: true, orderIds: entry.orderIds, query: entry.query }
      : { auto: false },
    attach,
  };
}
