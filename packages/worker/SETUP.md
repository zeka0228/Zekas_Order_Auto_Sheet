# Phase 0 — Cloudflare 인프라 셋업 가이드

> Worker를 처음 배포하기 위해 본인 Cloudflare 계정에서 한 번씩 실행해야 하는 명령을 정리. 모든 명령은 **저장소 루트**에서 실행하면 됩니다 (`pnpm --filter @zoas/worker exec` 패턴).

---

## 0. 사전 확인

- Cloudflare 계정 + 무료 등급 D1·KV 활성화
- `pnpm install` 완료 (wrangler가 worker 패키지 devDep으로 들어옴)

## 1. wrangler 로그인 (한 번만)

브라우저가 자동으로 열리고 Cloudflare 계정 인증을 요청합니다.

```bash
pnpm --filter @zoas/worker exec wrangler login
```

## 2. D1 데이터베이스 생성

```bash
pnpm --filter @zoas/worker exec wrangler d1 create zoas-configs
```

출력 예시:
```
✅ Successfully created DB 'zoas-configs' in region APAC
[[d1_databases]]
binding = "DB"
database_name = "zoas-configs"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

→ **`database_id` UUID를 복사해서 알려주세요.** `packages/worker/wrangler.toml`의 `database_id = "PLACEHOLDER_RUN_WRANGLER_D1_CREATE"` 자리에 주입합니다.

## 3. KV 네임스페이스 생성 (rate-limit 카운터)

```bash
pnpm --filter @zoas/worker exec wrangler kv namespace create RATE_LIMIT
```

출력 예시:
```
🌀 Creating namespace with title "zoas-worker-RATE_LIMIT"
✨ Success!
Add the following to your configuration file in your kv_namespaces array:
[[kv_namespaces]]
binding = "RATE_LIMIT"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

→ **`id` 값(32자 hex)을 복사해서 알려주세요.** `wrangler.toml`의 `id = "PLACEHOLDER_RUN_WRANGLER_KV_CREATE"` 자리에 주입합니다.

## 4. 운영용 Anthropic API 키 등록 (시크릿)

```bash
pnpm --filter @zoas/worker exec wrangler secret put ANTHROPIC_API_KEY
```

프롬프트가 뜨면 Anthropic Console에서 발급받은 키(`sk-ant-…`)를 붙여넣고 Enter. 시크릿은 Cloudflare에 암호화 저장되며 다시 조회할 수 없습니다.

> 평문 키는 절대 git에 커밋하지 마세요. 로컬 개발용은 `packages/worker/.dev.vars`에 같은 형식으로 두며 `.gitignore` 처리되어 있습니다 (`.dev.vars.example` 참조).

## 5. D1 마이그레이션 적용

먼저 로컬:

```bash
pnpm --filter @zoas/worker db:migrate:local
```

그 다음 운영:

```bash
pnpm --filter @zoas/worker db:migrate:prod
```

`migrations/0001_init.sql`이 적용되어 `configs` 테이블과 두 인덱스가 생성됩니다.

## 6. 배포

```bash
pnpm --filter @zoas/worker run deploy
```

> `run`을 빼면 pnpm이 `deploy`를 내장 명령으로 가로채 `ERR_PNPM_INVALID_DEPLOY_TARGET`이 납니다. 스크립트 실행임을 명시하려면 `run`을 붙이세요.

출력 마지막 줄에 배포 URL이 나옵니다:
```
Published zoas-worker (X.XX sec)
  https://zoas-worker.<your-subdomain>.workers.dev
```

→ **이 URL을 알려주세요.** `packages/extension/lib/config-client.ts`의 `DEFAULT_BASE` 상수에 주입합니다.

## 7. /health 확인

```bash
curl https://zoas-worker.<your-subdomain>.workers.dev/health
```

기대 응답:
```json
{"ok":true}
```

---

## 트러블슈팅

- **`wrangler` 명령 not found** — `pnpm install`이 안 되었거나 hoist 위치가 다름. `pnpm --filter @zoas/worker exec wrangler ...` 형태로 실행하세요.
- **`Authentication error`** — 2번의 `wrangler login`을 다시 실행하세요.
- **D1 무료 등급 초과** — 무료 등급은 일 5M 행 read / 100K write. Phase 5에서 모니터링 알림 추가 예정 (명세서 §11.3 O1).
- **시크릿이 deploy 후 안 보임** — `wrangler secret list`로 확인. `ANTHROPIC_API_KEY`가 목록에 있어야 합니다.

## 자가 점검 체크리스트 (배포 후)

- [ ] `curl https://<worker>/health` → `{"ok":true}`
- [ ] `curl https://<worker>/configs?type=shop&domain=example.com` → `Not Found` (404, 정상 — DB 비어있음)
- [ ] Cloudflare dashboard → Workers & Pages → `zoas-worker` → Settings → Variables and Secrets에 `ANTHROPIC_API_KEY` 표시
- [ ] D1 dashboard에서 `configs` 테이블 schema 확인

## 다음 단계

위 1-7을 모두 통과하면 알려주세요. 다음 작업:
1. `wrangler.toml`에 받은 `database_id` / `kv id` 주입 (commit)
2. `extension/lib/config-client.ts`의 `DEFAULT_BASE`를 배포 URL로 갱신 (commit)
3. `/health` 엔드포인트 단위 테스트 추가
4. 로드맵 §3 체크박스 갱신
5. PR 생성 → 머지 후 Phase 2로 진행
