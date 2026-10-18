-- 赛事级平台主客覆盖：force_aligned / force_reversed；无行则 reconcile 自动判定
CREATE TABLE IF NOT EXISTS client_match_platform_overrides (
  client_match_id BIGINT NOT NULL REFERENCES client_matches(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('force_aligned', 'force_reversed')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_match_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_client_match_platform_overrides_cm
  ON client_match_platform_overrides (client_match_id);
