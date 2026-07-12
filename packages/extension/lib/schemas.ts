/**
 * Extension-local 스키마.
 *
 * extension ↔ worker 공유 스키마는 `@zoas/shared`로 분리되어 있다.
 * 여기에는 chrome.storage에만 머무는 extension-only 스키마만 둔다.
 */
import { z } from 'zod';

export {
  SiteConfigSchema,
  ConfigTypeSchema,
  type SiteConfig,
  type ConfigType,
} from '@zoas/shared';

/** chrome.storage.local에 저장되는 캡처된 주문 한 건 */
export const PendingOrderSchema = z.object({
  id: z.string(),
  domain: z.string(),
  url: z.string(),
  capturedAt: z.number().int(),
  source: z.enum(['checkout', 'gmail', 'manual']),
  orderNumber: z.string().optional(),
  productName: z.string().optional(),
  price: z
    .object({
      amount: z.number(),
      currency: z.string(),
    })
    .optional(),
  needsHumanReview: z.boolean().default(false),
  raw: z.record(z.unknown()).optional(),
});
export type PendingOrder = z.infer<typeof PendingOrderSchema>;

/** 사용자 설정 */
export const SettingsSchema = z.object({
  proEnabled: z.boolean().default(false),
  anthropicApiKey: z.string().optional(),
  workerBaseUrl: z.string().url().optional(),
  /** 온보딩(첫 설치 안내) 완료 여부. false면 options에서 질문 카드를 띄운다. */
  onboarded: z.boolean().default(false),
  /**
   * 배송대행 주문확인 메일을 Gmail로 받는가. true일 때만 Gmail 열람-시 백필(§1.9)과
   * background 자동 백필 탭(§1.9 후속)을 동작시킨다. false(또는 미온보딩 기본)면 메일 e2e를
   * 돌리지 않고 주문번호는 popup 수동 입력에 의존한다.
   */
  gmailOrderEmails: z.boolean().default(false),
  /**
   * 사용자가 등록한 배송대행지(배대지) 도메인 목록. 배대지는 개인당 사실상 고정 1개라
   * 쇼핑몰처럼 휴리스틱으로 매번 추정하기보다 등록 도메인에서만 폼 자동 채움을 활성화한다
   * (Phase 4 — 오탐 0). 비면 배대지 폼 채움이 어느 사이트에서도 동작하지 않는다.
   */
  baedaejiDomains: z.array(z.string()).default([]),
});
export type Settings = z.infer<typeof SettingsSchema>;

/**
 * background가 자동으로 연 Gmail 백필 탭 한 건의 레지스트리 항목(§1.9 후속 — 자동 백필 탭).
 * chrome.storage.session에 저장한다(SW 재시작에도 브라우저 세션 동안 유지). content script가
 * 시작 시 AUTO_TAB_READY로 자신의 tabId를 보내면 background가 이 레지스트리로 "auto 탭 여부 +
 * 대상 orderId/query"를 되돌려준다 — 검색 해시 URL에 식별을 싣지 못하기 때문(Gmail SPA가
 * 커스텀 쿼리파라미터 보존을 보장하지 않음).
 */
export const AutoTabEntrySchema = z.object({
  /** 도메인 라벨(예: "asobistore"). 중복 탭 방지·알람명 키로 쓰는 그룹 식별자. */
  groupId: z.string(),
  /** tabs.create 직후 부착되는 탭 id. 생성 직전 센티넬 단계에선 없을 수 있다. */
  tabId: z.number().int().optional(),
  /** 이 탭이 백필하려는 후보 주문 id들(orderNumber 빈 것). */
  orderIds: z.array(z.string()),
  /** 탭이 연 Gmail 검색 쿼리(tabId 미부착 시 폴백 매칭에 사용). */
  query: z.string(),
  /** 탭을 연 시각(epoch ms). orphan sweep의 maxLifetime 판정에 쓴다. */
  openedAt: z.number().int(),
});
export type AutoTabEntry = z.infer<typeof AutoTabEntrySchema>;

/**
 * tier-3 장기 재시도 상태(§1.9 후속 — 자동 백필 탭). chrome.storage.local에 저장한다(브라우저
 * 재시작까지 영속, chrome.alarms와 수명 정렬). 알람은 payload를 못 실으므로 알람명(autobackfill:
 * <groupId>)으로 이 상태를 조회해 시도 횟수·대상·쿼리를 복원한다.
 */
export const RetryStateSchema = z.object({
  groupId: z.string(),
  orderIds: z.array(z.string()),
  query: z.string(),
  /** 지금까지 발사된 알람 재시도 횟수. */
  attempts: z.number().int(),
  /** 첫 알람을 건 시각(epoch ms). TTL 총량 캡 판정용. */
  firstScheduledAt: z.number().int(),
});
export type RetryState = z.infer<typeof RetryStateSchema>;
