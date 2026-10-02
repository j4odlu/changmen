import { getPgPool } from './common.js';

export const certificateRegistryEnabled = () => process.env.CLIENT_CERT_REGISTRY_ENABLED === '1';
const pool = () => { const p = getPgPool(); if (!p) throw new Error('Certificate database unavailable'); return p; };
export async function getClientCertificate(fingerprint) {
  return (await pool().query('SELECT * FROM client_certificates WHERE fingerprint=$1', [fingerprint])).rows[0] || null;
}
export async function listClientCertificates() {
  const certificates = (await pool().query(`SELECT c.fingerprint,c.user_id,c.serial,c.subject_cn,c.label,c.not_before,c.expires_at,
    c.created_at,c.revoked_at,c.revoke_reason,u.user_name FROM client_certificates c JOIN users u ON u.id=c.user_id ORDER BY c.created_at DESC`)).rows;
  const users = (await pool().query('SELECT id,user_name FROM users ORDER BY user_name')).rows;
  return { certificates, users };
}
export async function registerClientCertificate(data, actorId, operation = 'REGISTER') {
  const c = await pool().connect();
  try {
    await c.query('BEGIN');
    const existing = (await c.query(`INSERT INTO client_certificates
      (fingerprint,user_id,serial,subject_cn,label,certificate_pem,not_before,expires_at,created_at,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (fingerprint) DO NOTHING RETURNING fingerprint`,
    [data.fingerprint,data.userId,data.serial,data.cn,data.label || '',data.pem,data.notBefore,data.expiresAt,Date.now(),actorId])).rows;
    if (!existing.length) throw Object.assign(new Error('该证书已登记，不能重新绑定或恢复已吊销证书'), { status: 409 });
    await c.query('INSERT INTO client_certificate_audit(actor_id,user_id,fingerprint,operation,created_at) VALUES($1,$2,$3,$4,$5)',
      [actorId,data.userId,data.fingerprint,operation,Date.now()]);
    await c.query('COMMIT');
    return { fingerprint: data.fingerprint };
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
export async function revokeClientCertificate(fingerprint, actorId, reason) {
  const c = await pool().connect();
  try {
    await c.query('BEGIN');
    const row = (await c.query('SELECT * FROM client_certificates WHERE fingerprint=$1 FOR UPDATE', [fingerprint])).rows[0];
    if (!row) throw Object.assign(new Error('证书不存在'), { status: 404 });
    await c.query('UPDATE client_certificates SET revoked_at=COALESCE(revoked_at,$2),revoked_by=$3,revoke_reason=$4 WHERE fingerprint=$1', [fingerprint,Date.now(),actorId,reason]);
    for (const table of ['auth_sessions','auth_refresh_tokens']) {
      await c.query(`UPDATE ${table} SET revoked_at=COALESCE(revoked_at,$3),revoke_reason='CERT_REVOKED'
        WHERE user_id=$1 AND (cert_fingerprint=$2 OR (cert_fingerprint IS NULL AND lower(cert_cn)=lower($4)))`,
      [row.user_id,fingerprint,Date.now(),row.subject_cn]);
    }
    await c.query('INSERT INTO client_certificate_audit(actor_id,user_id,fingerprint,operation,created_at) VALUES($1,$2,$3,$4,$5)', [actorId,row.user_id,fingerprint,'REVOKE',Date.now()]);
    await c.query('COMMIT'); return { revoked: true };
  } catch(e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
/** Validate the presented leaf against its immutable owner; unknown legacy leaves retain CN compatibility. */
export async function authorizeClientCertificate(audit, userId) {
  if (!certificateRegistryEnabled()) return null;
  if (!/^[a-f0-9]{64}$/.test(audit?.certFingerprint || '')) return 'CERT_BIND_FAILED';
  const row = await getClientCertificate(audit.certFingerprint);
  if (row) return row.revoked_at || Number(row.expires_at) <= Date.now() || String(row.user_id) !== String(userId) ? 'CERT_BIND_FAILED' : null;
  if (process.env.CLIENT_CERT_LEGACY_ENABLED !== '1') return 'CERT_BIND_FAILED';
  const user = (await pool().query('SELECT user_name FROM users WHERE id=$1', [userId])).rows[0];
  return user && user.user_name.toLowerCase() === String(audit.certCn || '').toLowerCase() ? null : 'CERT_BIND_FAILED';
}
