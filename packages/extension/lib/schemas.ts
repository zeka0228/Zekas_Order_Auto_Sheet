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
});
export type Settings = z.infer<typeof SettingsSchema>;
