import { z } from 'zod';
import type { Env } from '../env';
import { checkRateLimit } from '../rate-limit';
import { recordFeedback } from '../db';

const Body = z.object({
  config_id: z.number().int(),
  outcome: z.enum(['success', 'failure']),
});

export async function handleFeedback(req: Request, env: Env): Promise<Response> {
  const anonId = req.headers.get('X-Anon-Id') ?? 'anonymous';
  const limited = await checkRateLimit(env, anonId, 'configs:feedback', {
    perMinute: 30,
  });
  if (limited) return new Response('Too Many Requests', { status: 429 });

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return new Response(JSON.stringify(parsed.error.issues), { status: 400 });
  }
  await recordFeedback(env, parsed.data.config_id, parsed.data.outcome);
  return Response.json({ ok: true });
}
