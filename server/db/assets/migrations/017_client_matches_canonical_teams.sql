-- 锁定 client_match canonical 主客（gb_team_id），Title 从该锚点派生，不随平台优先级漂移。

BEGIN;

ALTER TABLE client_matches
  ADD COLUMN IF NOT EXISTS home_gb_team_id bigint,
  ADD COLUMN IF NOT EXISTS away_gb_team_id bigint;

ALTER TABLE client_matches_history
  ADD COLUMN IF NOT EXISTS home_gb_team_id bigint,
  ADD COLUMN IF NOT EXISTS away_gb_team_id bigint;

COMMIT;
