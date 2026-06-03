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
   * 배송대행 주문확인 메일을 Gmail로 받는가. true일 때만 Gmail 열람-시 백필(§1.9)을 동작시킨다.
   * false(또는 미온보딩 기본)면 메일 e2e를 돌리지 않고 주문번호는 popup 수동 입력에 의존한다.
   */
  gmailOrderEmails: z.boolean().default(false),
});
export type Settings = z.infer<typeof SettingsSchema>;
