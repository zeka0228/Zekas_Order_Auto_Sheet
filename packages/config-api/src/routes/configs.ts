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

  const type = url.searchParams.get('type');
  const domain = url.searchParams.get('domain');
  if (type !== 'shop' && type !== 'baedaeji') {
    return new Response('Bad type', { status: 400 });
  }
  if (!domain) return new Response('Missing domain', { status: 400 });

  const config = await findBestConfig(env, domain, type);
  if (!config) return new Response('Not Found', { status: 404 });
  return Response.json(config);
}
