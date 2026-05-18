import type { Env } from './env';

export interface ConfigRow {
  id: number;
  type: 'shop' | 'baedaeji';
  domain: string;
  urlPattern: string;
  version: number;
  selectors: Record<string, string>;
  language: string | null;
  country: string | null;
}

interface RawRow {
  id: number;
  type: 'shop' | 'baedaeji';
  domain: string;
  url_pattern: string;
  version: number;
  config_json: string;
  language: string | null;
  country: string | null;
}

function toConfig(row: RawRow): ConfigRow {
  let selectors: Record<string, string> = {};
  try {
    const parsed = JSON.parse(row.config_json) as { selectors?: unknown };
    if (parsed.selectors && typeof parsed.selectors === 'object') {
      selectors = parsed.selectors as Record<string, string>;
    }
  } catch {
    /* leave empty */
  }
  return {
    id: row.id,
    type: row.type,
    domain: row.domain,
    urlPattern: row.url_pattern,
    version: row.version,
    selectors,
    language: row.language,
    country: row.country,
  };
}

export async function findBestConfig(
  env: Env,
  domain: string,
  type: 'shop' | 'baedaeji',
): Promise<ConfigRow | null> {
  const row = await env.DB.prepare(
    `SELECT id, type, domain, url_pattern, version, config_json, language, country
       FROM configs
      WHERE domain = ? AND type = ? AND is_invalidated = 0
      ORDER BY success_count DESC, version DESC
      LIMIT 1`,
  )
    .bind(domain, type)
    .first<RawRow>();
  return row ? toConfig(row) : null;
}

export async function insertConfig(
  env: Env,
  args: {
    type: 'shop' | 'baedaeji';
    domain: string;
    urlPattern: string;
    configJson: string;
    language?: string;
    country?: string;
  },
): Promise<{ id: number; version: number; urlPattern: string }> {
  const versionRow = await env.DB.prepare(
    `SELECT COALESCE(MAX(version), 0) AS v FROM configs
      WHERE type = ? AND domain = ? AND url_pattern = ?`,
  )
    .bind(args.type, args.domain, args.urlPattern)
    .first<{ v: number }>();
  const nextVersion = (versionRow?.v ?? 0) + 1;

  const res = await env.DB.prepare(
    `INSERT INTO configs
       (type, domain, url_pattern, config_json, language, country, version)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      args.type,
      args.domain,
      args.urlPattern,
      args.configJson,
      args.language ?? null,
      args.country ?? null,
      nextVersion,
    )
    .run();

  return {
    id: Number(res.meta.last_row_id),
    version: nextVersion,
    urlPattern: args.urlPattern,
  };
}

export async function recordFeedback(
  env: Env,
  configId: number,
  outcome: 'success' | 'failure',
): Promise<void> {
  const column = outcome === 'success' ? 'success_count' : 'failure_count';
  await env.DB.prepare(
    `UPDATE configs
        SET use_count = use_count + 1,
            ${column} = ${column} + 1,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
  )
    .bind(configId)
    .run();

  // 임계치 도달 시 자동 invalidate
  await env.DB.prepare(
    `UPDATE configs
        SET is_invalidated = 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND use_count > 10
        AND (CAST(failure_count AS REAL) / CAST(use_count AS REAL)) > 0.5`,
  )
    .bind(configId)
    .run();
}
