import type { Env } from './env';

interface Limits {
  perMinute?: number;
  perHour?: number;
}

/**
 * 매우 단순한 KV 기반 카운터. KV write 지연은 있지만 abuse 한도 차단 용도라 OK.
 * 더 엄격한 게이팅이 필요하면 Durable Object로 교체.
 */
export async function checkRateLimit(
  env: Env,
  anonId: string,
  bucket: string,
  limits: Limits,
): Promise<boolean> {
  const now = Date.now();
  if (limits.perMinute) {
    const window = Math.floor(now / 60_000);
    const key = `${bucket}:${anonId}:m:${window}`;
    if (await bump(env, key, limits.perMinute, 70)) return true;
  }
  if (limits.perHour) {
    const window = Math.floor(now / 3_600_000);
    const key = `${bucket}:${anonId}:h:${window}`;
    if (await bump(env, key, limits.perHour, 3700)) return true;
  }
  return false;
}

async function bump(
  env: Env,
  key: string,
  max: number,
  ttlSeconds: number,
): Promise<boolean> {
  const current = Number((await env.RATE_LIMIT.get(key)) ?? '0');
  if (current >= max) return true;
  await env.RATE_LIMIT.put(key, String(current + 1), {
    expirationTtl: ttlSeconds,
  });
  return false;
}
