/**
 * @zoas/shared
 *
 * extension ↔ worker 사이에서 통신하는 모든 페이로드의 Zod 스키마.
 * 이 패키지 외부에서 수동으로 정의된 동일 모양의 타입이 발견되면 즉시 여기로 옮긴다.
 */
import { z } from 'zod';

/** Config 종류 — 쇼핑몰 결제 페이지 vs 배대지 주문서 페이지. */
export const ConfigTypeSchema = z.enum(['shop', 'baedaeji']);
export type ConfigType = z.infer<typeof ConfigTypeSchema>;

/**
 * Worker가 반환하는 사이트별 config.
 *
 * D1 row에서 language/country는 NULL일 수 있어 nullish()로 받음 — undefined든 null이든 통과.
 * (기존 extension 쪽이 .optional()만 받아 null이 오면 parse 실패하던 잠재 버그를 통합 시 발견)
 */
export const SiteConfigSchema = z.object({
  id: z.number().int(),
  type: ConfigTypeSchema,
  domain: z.string(),
  urlPattern: z.string(),
  version: z.number().int(),
  selectors: z.record(z.string()),
  language: z.string().nullish(),
  country: z.string().nullish(),
});
export type SiteConfig = z.infer<typeof SiteConfigSchema>;

/** POST /generate-config 요청 본문. */
export const GenerateConfigRequestSchema = z.object({
  domain: z.string().min(1),
  type: ConfigTypeSchema,
  sanitized_html: z.string().min(1).max(500_000),
  url_pattern: z.string().optional(),
});
export type GenerateConfigRequest = z.infer<typeof GenerateConfigRequestSchema>;

/** POST /feedback 요청 본문. */
export const FeedbackRequestSchema = z.object({
  config_id: z.number().int(),
  outcome: z.enum(['success', 'failure']),
});
export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>;
