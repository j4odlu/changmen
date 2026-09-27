-- 浏览器服务端会话 + 可轮换 refresh token。
-- 仅保存 secret 的 SHA-256，不落任何可直接使用的凭证。
CREATE TABLE IF NOT EXISTS auth_sessions (
  id                   uuid PRIMARY KEY,
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  jwt_session_id       text NOT NULL,
  secret_hash          text NOT NULL,
  cert_cn              text NOT NULL DEFAULT '',
  client_ip            text NOT NULL DEFAULT '',
  user_agent           text NOT NULL DEFAULT '',
  created_at           bigint NOT NULL,
  last_seen_at         bigint NOT NULL,
  idle_expires_at      bigint NOT NULL,
  absolute_expires_at  bigint NOT NULL,
  revoked_at           bigint,
  revoke_reason        text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS auth_sessions_user_active_idx
  ON auth_sessions (user_id, absolute_expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx
  ON auth_sessions (absolute_expires_at);

CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  id              uuid PRIMARY KEY,
  family_id       uuid NOT NULL,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id      text NOT NULL,
  secret_hash     text NOT NULL,
  cert_cn         text NOT NULL DEFAULT '',
  created_at      bigint NOT NULL,
  expires_at      bigint NOT NULL,
  used_at         bigint,
  revoked_at      bigint,
  revoke_reason   text NOT NULL DEFAULT '',
  replaced_by_id  uuid
);

CREATE INDEX IF NOT EXISTS auth_refresh_tokens_family_idx
  ON auth_refresh_tokens (family_id, created_at DESC);

CREATE INDEX IF NOT EXISTS auth_refresh_tokens_user_active_idx
  ON auth_refresh_tokens (user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS auth_refresh_tokens_expiry_idx
  ON auth_refresh_tokens (expires_at);
