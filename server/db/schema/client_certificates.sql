BEGIN;
CREATE TABLE IF NOT EXISTS client_certificates (
  fingerprint text PRIMARY KEY CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  user_id uuid NOT NULL REFERENCES users(id),
  serial text NOT NULL, subject_cn text NOT NULL,
  label text NOT NULL DEFAULT '', certificate_pem text NOT NULL,
  not_before bigint NOT NULL, expires_at bigint NOT NULL,
  created_at bigint NOT NULL, created_by uuid REFERENCES users(id),
  revoked_at bigint, revoked_by uuid REFERENCES users(id), revoke_reason text
);
CREATE INDEX IF NOT EXISTS client_certificates_user ON client_certificates(user_id);
CREATE TABLE IF NOT EXISTS client_certificate_audit (
  id bigserial PRIMARY KEY, actor_id uuid REFERENCES users(id), user_id uuid REFERENCES users(id),
  fingerprint text, operation text NOT NULL, created_at bigint NOT NULL
);
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS cert_fingerprint text;
ALTER TABLE auth_refresh_tokens ADD COLUMN IF NOT EXISTS cert_fingerprint text;
ALTER TABLE client_certificates ADD COLUMN IF NOT EXISTS replaces_fingerprint text REFERENCES client_certificates(fingerprint);
ALTER TABLE client_certificate_audit ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMIT;
