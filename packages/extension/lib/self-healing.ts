import { generateConfig, reportFailure, reportSuccess } from './config-client';
import { sanitizeHTML } from './html-masker';
import type { SiteConfig } from './schemas';

/**
 * 셀렉터로 파싱했으나 결과가 비어 있으면 실패로 보고하고 재생성을 시도한다.
 * 기술명세서 §6.3 자가 치유 흐름.
 */
export async function tryHeal(args: {
  domain: string;
  type: 'shop' | 'baedaeji';
  failedConfig: SiteConfig | null;
  root: Element;
}): Promise<SiteConfig | null> {
  if (args.failedConfig) {
    await reportFailure(args.failedConfig.id);
  }
  const sanitized = sanitizeHTML(args.root);
  return generateConfig(args.domain, args.type, sanitized);
}

export async function reportParseOutcome(
  config: SiteConfig,
  ok: boolean,
): Promise<void> {
  if (ok) await reportSuccess(config.id);
  else await reportFailure(config.id);
}
