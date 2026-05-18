import { GenerateConfigRequestSchema } from '@zoas/shared';
import type { Env } from '../env';
import { checkRateLimit } from '../rate-limit';
import { validateMasking } from '../mask-validator';
import { findBestConfig, insertConfig } from '../db';
import { generateSelectorsWithAI } from '../ai-proxy';

export async function handleGenerate(req: Request, env: Env): Promise<Response> {
  const anonId = req.headers.get('X-Anon-Id') ?? 'anonymous';
  const limited = await checkRateLimit(env, anonId, 'configs:generate', {
    perMinute: 3,
    perHour: 20,
  });
  if (limited) return new Response('Too Many Requests', { status: 429 });

  const json = await req.json().catch(() => null);
  const parsed = GenerateConfigRequestSchema.safeParse(json);
  if (!parsed.success) {
    return new Response(JSON.stringify(parsed.error.issues), { status: 400 });
  }
  const { domain, type, sanitized_html, url_pattern } = parsed.data;

  if (!validateMasking(sanitized_html)) {
    return new Response('Masking insufficient', { status: 400 });
  }

  // 이미 있으면 그것 반환 (race 방지)
  const existing = await findBestConfig(env, domain, type);
  if (existing) return Response.json(existing);

  const selectors = await generateSelectorsWithAI(env, type, sanitized_html);
  if (!selectors) {
    return new Response('AI generation failed', { status: 502 });
  }

  const inserted = await insertConfig(env, {
    type,
    domain,
    urlPattern: url_pattern ?? '*',
    configJson: JSON.stringify({ selectors }),
  });

  return Response.json({
    id: inserted.id,
    type,
    domain,
    urlPattern: inserted.urlPattern,
    version: inserted.version,
    selectors,
  });
}
