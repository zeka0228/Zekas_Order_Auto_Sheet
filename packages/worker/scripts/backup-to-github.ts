/**
 * 일 1회 D1 dump → GitHub 백업.
 * Phase 5에서 실 구현. 현재는 자리만.
 *
 * 실행 예: pnpm backup
 */
async function main() {
  console.log('[ZOAS] backup script — not yet implemented');
  // TODO:
  // 1. wrangler d1 export zoas-configs --remote --output backup.sql
  // 2. GitHub API로 zoas-backups 레포에 날짜별 커밋
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
