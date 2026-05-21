export interface Env {
  DB: D1Database;
  RATE_LIMIT: KVNamespace;
  ANTHROPIC_API_KEY: string;
  // Cloudflare AI Gateway 경유 설정 (지역 차단 우회 + 캐싱). 둘 다 있어야 게이트웨이 사용.
  AI_GATEWAY_ACCOUNT_ID?: string;
  AI_GATEWAY_NAME?: string;
}
