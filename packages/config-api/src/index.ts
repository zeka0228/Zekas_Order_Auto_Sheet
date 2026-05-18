import type { Env } from './env';
import { handleGetConfigs } from './routes/configs';
import { handleGenerate } from './routes/generate';
import { handleFeedback } from './routes/feedback';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Anon-Id',
};

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(req.url);
    try {
      const res = await route(req, url, env);
      return withCors(res);
    } catch (err) {
      console.error('[ZOAS] handler error:', err);
      return withCors(new Response('Internal Server Error', { status: 500 }));
    }
  },
} satisfies ExportedHandler<Env>;

async function route(req: Request, url: URL, env: Env): Promise<Response> {
  const { pathname } = url;

  if (req.method === 'GET' && pathname === '/health') {
    return Response.json({ ok: true });
  }
  if (req.method === 'GET' && pathname === '/configs') {
    return handleGetConfigs(req, url, env);
  }
  if (req.method === 'POST' && pathname === '/generate-config') {
    return handleGenerate(req, env);
  }
  if (req.method === 'POST' && pathname === '/feedback') {
    return handleFeedback(req, env);
  }
  return new Response('Not Found', { status: 404 });
}

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}
