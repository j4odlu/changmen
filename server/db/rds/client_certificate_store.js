import { getPgPool } from './common.js';
export const certificateRegistryEnabled = () => process.env.CLIENT_CERT_REGISTRY_ENABLED === '1';
const pool = () => { const p = getPgPool(); if (!p) throw new Error('Certificate database unavailable'); return p; };
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export async function getClientCertificate(fingerprint) {
  return (await pool().query('SELECT * FROM client_certificates WHERE fingerprint=$1', [fingerprint])).rows[0] || null;
}
export async function listClientCertificates() {
  const certificates = (await pool().query(`SELECT c.fingerprint,c.user_id,c.serial,c.subject_cn,c.label,c.not_before,c.expires_at,
    c.created_at,c.revoked_at,c.revoke_reason,c.replaces_fingerprint,u.user_name,
    (SELECT max(s.last_seen_at) FROM auth_sessions s WHERE s.user_id=c.user_id AND
      (s.cert_fingerprint=c.fingerprint OR (s.cert_fingerprint IS NULL AND lower(s.cert_cn)=lower(c.subject_cn)))) AS last_browser_activity,
    (SELECT count(*)::int FROM auth_sessions s WHERE s.user_id=c.user_id AND s.revoked_at IS NULL
      AND s.absolute_expires_at>$1 AND s.idle_expires_at>$1 AND s.jwt_session_id=u.metadata->>'active_session_id'
      AND (s.cert_fingerprint=c.fingerprint OR (s.cert_fingerprint IS NULL AND lower(s.cert_cn)=lower(c.subject_cn)))) AS active_sessions
    FROM client_certificates c JOIN users u ON u.id=c.user_id ORDER BY c.created_at DESC,c.fingerprint`, [Date.now()])).rows;
  const users = (await pool().query('SELECT id,user_name FROM users ORDER BY user_name')).rows;
  return { certificates, users };
}
export async function getClientCertificateDetail(fingerprint) {
  const certificate = await getClientCertificate(fingerprint);
  if (!certificate) throw fail('证书不存在', 404);
  const audit = (await pool().query(`SELECT a.id,a.operation,a.created_at,a.details,u.user_name AS actor_name
    FROM client_certificate_audit a LEFT JOIN users u ON u.id=a.actor_id
    WHERE a.fingerprint=$1 ORDER BY a.created_at DESC,a.id DESC LIMIT 100`,[fingerprint])).rows;
  return { certificate, audit };
}
async function recordAudit(c, actorId, userId, fingerprint, operation, details = {}) {
  await c.query('INSERT INTO client_certificate_audit(actor_id,user_id,fingerprint,operation,created_at,details) VALUES($1,$2,$3,$4,$5,$6)',
    [actorId,userId,fingerprint,operation,Date.now(),JSON.stringify(details)]);
}
export async function registerClientCertificate(data, actorId, operation = 'REGISTER') {
  const c = await pool().connect();
  try {
    await c.query('BEGIN');
    if (data.replacesFingerprint) {
      const previous = (await c.query('SELECT user_id FROM client_certificates WHERE fingerprint=$1 FOR UPDATE',[data.replacesFingerprint])).rows[0];
      if (!previous) throw fail('待续期或补发的原证书不存在',404);
      if (String(previous.user_id) !== String(data.userId)) throw fail('续期或补发不能改变证书所属用户',409);
    }
    const existing = (await c.query(`INSERT INTO client_certificates
      (fingerprint,user_id,serial,subject_cn,label,certificate_pem,not_before,expires_at,created_at,created_by,replaces_fingerprint)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (fingerprint) DO NOTHING RETURNING fingerprint`,
    [data.fingerprint,data.userId,data.serial,data.cn,data.label || '',data.pem,data.notBefore,data.expiresAt,Date.now(),actorId,data.replacesFingerprint || null])).rows;
    if (!existing.length) throw fail('该证书已登记，不能重新绑定或恢复已吊销证书',409);
    await recordAudit(c,actorId,data.userId,data.fingerprint,operation,{label:data.label || '',replacesFingerprint:data.replacesFingerprint || null});
    await c.query('COMMIT'); return { fingerprint: data.fingerprint };
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
export async function updateClientCertificateLabel(fingerprint, label, actorId) {
  if (typeof label !== 'string' || label.length > 80) throw fail('设备备注不能超过 80 个字符');
  const c = await pool().connect();
  try {
    await c.query('BEGIN');
    const row=(await c.query('SELECT user_id,label FROM client_certificates WHERE fingerprint=$1 FOR UPDATE',[fingerprint])).rows[0];
    if (!row) throw fail('证书不存在',404);
    await c.query('UPDATE client_certificates SET label=$2 WHERE fingerprint=$1',[fingerprint,label.trim()]);
    if (row.label !== label.trim()) await recordAudit(c,actorId,row.user_id,fingerprint,'LABEL',{before:row.label,after:label.trim()});
    await c.query('COMMIT'); return { updated:true };
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
export async function revokeClientCertificates(fingerprints, actorId, reason) {
  if (!Array.isArray(fingerprints) || fingerprints.length < 1 || fingerprints.length > 50
    || fingerprints.some(f=>typeof f !== 'string' || !/^[a-f0-9]{64}$/.test(f))) throw fail('请选择 1–50 张有效证书');
  const selected=[...new Set(fingerprints)].sort();
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 200) throw fail('请填写 1–200 字的吊销原因');
  const c = await pool().connect();
  try {
    await c.query('BEGIN');
    const rows=(await c.query('SELECT * FROM client_certificates WHERE fingerprint=ANY($1::text[]) ORDER BY fingerprint FOR UPDATE',[selected])).rows;
    if (rows.length !== selected.length) throw fail('所选证书不存在，请刷新列表',404);
    let revoked=0;
    for (const row of rows) {
      if (row.revoked_at) continue;
      await c.query('UPDATE client_certificates SET revoked_at=$2,revoked_by=$3,revoke_reason=$4 WHERE fingerprint=$1',[row.fingerprint,Date.now(),actorId,reason.trim()]);
      for (const table of ['auth_sessions','auth_refresh_tokens']) {
        await c.query(`UPDATE ${table} SET revoked_at=COALESCE(revoked_at,$3),revoke_reason='CERT_REVOKED'
          WHERE user_id=$1 AND (cert_fingerprint=$2 OR (cert_fingerprint IS NULL AND lower(cert_cn)=lower($4)))`,
        [row.user_id,row.fingerprint,Date.now(),row.subject_cn]);
      }
      await recordAudit(c,actorId,row.user_id,row.fingerprint,'REVOKE',{reason:reason.trim()});revoked++;
    }
    await c.query('COMMIT');return {revoked,unchanged:rows.length-revoked};
  } catch(e) { await c.query('ROLLBACK');throw e; } finally { c.release(); }
}
export async function revokeClientCertificate(fingerprint, actorId, reason) {
  await revokeClientCertificates([fingerprint],actorId,reason);return {revoked:true};
}
/** Registered certificates always use immutable ownership; revocation never falls back to CN. */
export async function authorizeClientCertificate(audit, userId) {
  if (!certificateRegistryEnabled()) return null;
  if (!/^[a-f0-9]{64}$/.test(audit?.certFingerprint || '')) return 'CERT_BIND_FAILED';
  const row = await getClientCertificate(audit.certFingerprint);
  if (row) return row.revoked_at || Number(row.expires_at) <= Date.now() || String(row.user_id) !== String(userId) ? 'CERT_BIND_FAILED' : null;
  if (process.env.CLIENT_CERT_LEGACY_ENABLED !== '1') return 'CERT_BIND_FAILED';
  const user = (await pool().query('SELECT user_name FROM users WHERE id=$1', [userId])).rows[0];
  return user && user.user_name.toLowerCase() === String(audit.certCn || '').toLowerCase() ? null : 'CERT_BIND_FAILED';
}
