# @zoas/worker

Cloudflare Worker + D1 — ZOAS의 **글로벌 Config DB**와 AI 프록시.

## 책임

1. `GET /configs?type=…&domain=…` — 캐시된 사이트 config 조회
2. `POST /generate-config` — 마스킹된 HTML 받아 **개발자 Anthropic 키**로 셀렉터 생성
3. `POST /feedback` — 사용자 익명 ID로부터 success/failure 보고 → 자가 치유

## 초기 셋업

상세한 단계별 가이드는 [`SETUP.md`](./SETUP.md) 참조. 요약:

```bash
# 저장소 루트에서 실행
pnpm --filter @zoas/worker exec wrangler login
pnpm --filter @zoas/worker exec wrangler d1 create zoas-configs          # → database_id 주입
pnpm --filter @zoas/worker exec wrangler kv namespace create RATE_LIMIT  # → id 주입
pnpm --filter @zoas/worker exec wrangler secret put ANTHROPIC_API_KEY
pnpm --filter @zoas/worker db:migrate:prod
pnpm --filter @zoas/worker deploy                                        # → 배포 URL
```

## 보안 메모

- **요청 본문 검증**: `mask-validator.ts`가 들어오는 HTML의 placeholder 비율을 확인.
  비율이 낮으면 마스킹 실패로 간주하고 400 응답 (실 데이터 차단).
- **Rate limit**: 익명 ID(`X-Anon-Id`) 단위로 분당/시간당 한도.
- **개발자 키**: `wrangler secret` 로만 관리. `.dev.vars`에 평문 보관 금지.

## 디렉토리

```
worker/
├── wrangler.toml
├── src/
│   ├── index.ts             # Router
│   ├── routes/
│   │   ├── configs.ts       # GET /configs
│   │   ├── generate.ts      # POST /generate-config
│   │   └── feedback.ts      # POST /feedback
│   ├── ai-proxy.ts          # Anthropic 호출
│   ├── mask-validator.ts    # 마스킹 검증
│   ├── db.ts                # D1 쿼리
│   ├── rate-limit.ts        # KV 기반 토큰버킷
│   └── env.ts               # 환경 바인딩 타입
├── migrations/
│   └── 0001_init.sql
└── scripts/
    └── backup-to-github.ts  # 일 1회 D1 dump → GitHub (Phase 5)
```
