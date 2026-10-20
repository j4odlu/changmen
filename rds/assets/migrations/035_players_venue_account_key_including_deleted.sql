-- venue_account_key 含软删互斥：A 删号后他人不可抢加；仅原主人可通过「添加账号」复活。
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/035_players_venue_account_key_including_deleted.sql
--
-- 历史：若 A 已软删且 B 已抢加（旧 active-only 唯一约束允许），迁移会保留优先活跃行的 key，清空其余行的 key。

BEGIN;

-- 同一 fingerprint 多行时：优先保留活跃，其次 updated_at 新，再次 id 大
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY venue_account_key
      ORDER BY (deleted_at IS NULL) DESC, updated_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM players
  WHERE venue_account_key <> ''
)
UPDATE players p
SET venue_account_key = '',
    updated_at = (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint
FROM ranked r
WHERE p.id = r.id
  AND r.rn > 1
  AND p.venue_account_key <> '';

DROP INDEX IF EXISTS players_venue_account_key_active;
DROP INDEX IF EXISTS players_venue_account_key_lookup;

-- 含软删：非空 venue_account_key 全库唯一
CREATE UNIQUE INDEX IF NOT EXISTS players_venue_account_key_all
  ON players (venue_account_key)
  WHERE venue_account_key <> '';

CREATE INDEX IF NOT EXISTS players_venue_account_key_lookup_all
  ON players (venue_account_key)
  WHERE venue_account_key <> '';

COMMIT;
