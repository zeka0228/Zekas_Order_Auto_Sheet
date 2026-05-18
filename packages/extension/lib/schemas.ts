import { z } from 'zod';

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

/** Worker가 반환하는 사이트별 config */
export const SiteConfigSchema = z.object({
  id: z.number().int(),
  type: z.enum(['shop', 'baedaeji']),
  domain: z.string(),
  urlPattern: z.string(),
  version: z.number().int(),
  selectors: z.record(z.string()),
  language: z.string().optional(),
  country: z.string().optional(),
});
export type SiteConfig = z.infer<typeof SiteConfigSchema>;

/** 사용자 설정 */
export const SettingsSchema = z.object({
  proEnabled: z.boolean().default(false),
  anthropicApiKey: z.string().optional(),
  workerBaseUrl: z.string().url().optional(),
});
export type Settings = z.infer<typeof SettingsSchema>;
