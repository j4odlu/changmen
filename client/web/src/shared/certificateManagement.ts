import type { CertificateRow } from '@/api/certificates';
export type CertificateState = 'valid' | 'expiring' | 'expired' | 'revoked' | 'pending';
export const certificateStateLabels: Record<CertificateState, string> = { valid: '有效', expiring: '30 天内到期', expired: '已过期', revoked: '已吊销', pending: '尚未生效' };
export function certificateState(row: Pick<CertificateRow, 'revoked_at' | 'expires_at' | 'not_before'>, now = Date.now()): CertificateState {
  if (row.revoked_at) return 'revoked';
  if (Number(row.expires_at) <= now) return 'expired';
  if (Number(row.not_before) > now) return 'pending';
  return Number(row.expires_at) - now <= 30 * 86400000 ? 'expiring' : 'valid';
}
export function filterCertificates(rows: CertificateRow[], query: string, userId: string, state: string, now = Date.now()) {
  const text = query.trim().toLowerCase();
  return rows.filter(row => (!userId || row.user_id === userId) && (!state || certificateState(row, now) === state)
    && (!text || [row.user_name, row.label, row.subject_cn, row.serial, row.fingerprint, row.user_id].some(v => String(v || '').toLowerCase().includes(text))));
}
export function certificateCsv(rows: CertificateRow[], now = Date.now()) {
  const cell = (value: unknown) => {
    let text = String(value ?? '');
    if (/^\s*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  return '\ufeff' + [['用户', '用户 ID', '设备备注', '状态', '序列号', '证书指纹', '生效时间', '到期时间', '吊销原因'],
    ...rows.map(r => [r.user_name, r.user_id, r.label, certificateStateLabels[certificateState(r,now)], r.serial, r.fingerprint,
      new Date(Number(r.not_before)).toISOString(), new Date(Number(r.expires_at)).toISOString(), r.revoke_reason || ''])]
    .map(row => row.map(cell).join(',')).join('\r\n');
}
