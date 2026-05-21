import { describe, expect, it } from 'vitest';
import worker from './index';
import type { Env } from './env';

/**
 * 라우터 표면(surface) 단위 테스트. DB/KV를 건드리지 않는 경로만 검증한다.
 *   - /health 는 Phase 0 배포 검증의 기준점 (SETUP.md §7)
 *   - 알 수 없는 경로는 404
 *   - 모든 응답에 CORS 헤더가 붙는다 (확장에서 fetch 하므로 필수)
 * 실 D1·KV 위 통합 테스트(configs/generate/feedback)는 Phase 0 이후
 * @cloudflare/vitest-pool-workers 도입 시 별도로 추가한다.
 */
const env = {} as Env; // /health·404·OPTIONS 는 바인딩을 사용하지 않음
const ctx = {} as ExecutionContext;

describe('worker router', () => {
  it('GET /health → 200 {ok:true}', async () => {
    const res = await worker.fetch(new Request('https://w/health'), env, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('알 수 없는 경로 → 404', async () => {
    const res = await worker.fetch(new Request('https://w/nope'), env, ctx);
    expect(res.status).toBe(404);
  });

  it('POST /health → 404 (메서드 불일치)', async () => {
    const res = await worker.fetch(
      new Request('https://w/health', { method: 'POST' }),
      env,
      ctx,
    );
    expect(res.status).toBe(404);
  });

  it('OPTIONS 프리플라이트 → CORS 헤더 포함', async () => {
    const res = await worker.fetch(
      new Request('https://w/configs', { method: 'OPTIONS' }),
      env,
      ctx,
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('X-Anon-Id');
  });

  it('정상 응답에도 CORS 헤더가 붙는다', async () => {
    const res = await worker.fetch(new Request('https://w/health'), env, ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
