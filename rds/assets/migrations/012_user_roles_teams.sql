-- users.role + team_id：三级角色（admin/leader/user）+ 团队分组
BEGIN;

-- 团队表
CREATE TABLE IF NOT EXISTS teams (
  id    text PRIMARY KEY,
  name  text NOT NULL,
  created_at bigint NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS team_id text DEFAULT NULL REFERENCES teams(id) ON DELETE SET NULL;

-- 回填：现有管理员 → role='admin'
UPDATE users
SET role = 'admin',
    updated_at = GREATEST(updated_at, (extract(epoch from now()) * 1000)::bigint)
WHERE is_admin = true AND role = 'user';

CREATE INDEX IF NOT EXISTS idx_users_team_id ON users(team_id);

COMMIT;
