import { ConfigTypeSchema } from '@zoas/shared';
import type { Env } from '../env';
import { checkRateLimit } from '../rate-limit';
import { findBestConfig } from '../db';

export async function handleGetConfigs(
  req: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  const anonId = req.headers.get('X-Anon-Id') ?? 'anonymous';
  const limited = await checkRateLimit(env, anonId, 'configs:get', {
    perMinute: 60,
  });
  if (limited) return new Response('Too Many Requests', { status: 429 });

  const parsedType = ConfigTypeSchema.safeParse(url.searchParams.get('type'));
  if (!parsedType.success) {
    return new Response('Bad type', { status: 400 });
  }
  const domain = url.searchParams.get('domain');
  if (!domain) return new Response('Missing domain', { status: 400 });

  const config = await findBestConfig(env, domain, parsedType.data);
  if (!config) return new Response('Not Found', { status: 404 });
  return Response.json(config);
}
