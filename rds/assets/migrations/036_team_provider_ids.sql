-- team_provider_ids：canonical 队伍的多数据源 provider 索引（阶段一：兼容层）
-- 现状 canonical_teams 仅一列 pandascore_id；本表把「源 → ID」从列升级为行，
-- 供 liquipedia / reep / 赛事方官方 ID 等多源落库，与 pandascore_id 并存兼容。
-- 锚点 team_id = canonical_teams.id（稳定主键），对外 gb_team_id 语义不变。

BEGIN;

CREATE TABLE IF NOT EXISTS team_provider_ids (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id     bigint NOT NULL REFERENCES canonical_teams(id) ON DELETE CASCADE,
  provider    text NOT NULL,             -- 'pandascore' | 'liquipedia' | 'reep' | ...
  provider_id text NOT NULL,
  game        text,
  source      text NOT NULL DEFAULT 'auto',
  confidence  numeric(3,2) NOT NULL DEFAULT 1.00,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_id),
  UNIQUE (team_id, provider, game)
);

CREATE INDEX IF NOT EXISTS team_provider_ids_team_idx
  ON team_provider_ids (team_id);

-- 存量回填：pandascore_id → team_provider_ids（幂等，重复执行不会重复插）
INSERT INTO team_provider_ids (team_id, provider, provider_id, game, source, confidence)
SELECT id, 'pandascore', pandascore_id, game, 'migrate', 1.00
FROM canonical_teams
WHERE pandascore_id IS NOT NULL
ON CONFLICT (provider, provider_id) DO NOTHING;

COMMIT;
