-- 登录态审计：只存 session 前缀，不落完整 access/refresh token。
CREATE TABLE IF NOT EXISTS auth_session_audit (
  id                 bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id            uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  user_name          text NOT NULL DEFAULT '',
  event_type         text NOT NULL,
  result             text NOT NULL,
  reason_code        text NOT NULL DEFAULT '',
  session_id_prefix  text NOT NULL DEFAULT '',
  client_ip          text NOT NULL DEFAULT '',
  cert_cn            text NOT NULL DEFAULT '',
  user_agent         text NOT NULL DEFAULT '',
  created_at         bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_session_audit_user_created_idx
  ON auth_session_audit (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS auth_session_audit_name_created_idx
  ON auth_session_audit (lower(user_name), created_at DESC);

CREATE INDEX IF NOT EXISTS auth_session_audit_event_created_idx
  ON auth_session_audit (event_type, created_at DESC);
