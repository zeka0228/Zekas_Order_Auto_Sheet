-- Zekas Order Auto Sheet · Config DB 초기 스키마
-- 기술명세서 §5.1 참조

CREATE TABLE IF NOT EXISTS configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('shop','baedaeji')),
  domain TEXT NOT NULL,
  url_pattern TEXT NOT NULL,
  config_json TEXT NOT NULL,
  language TEXT,
  country TEXT,
  version INTEGER DEFAULT 1,
  use_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  is_invalidated INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(type, domain, url_pattern, version)
);

CREATE INDEX IF NOT EXISTS idx_lookup
  ON configs(type, domain, is_invalidated);

CREATE INDEX IF NOT EXISTS idx_quality
  ON configs(success_count DESC, failure_count ASC);
