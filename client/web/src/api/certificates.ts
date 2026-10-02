import { authHeaders } from '@/lib/authSession';
import { getApiBase } from '@/config/apiBase';
export type CertificateRow = { fingerprint: string; user_id: string; user_name: string; serial: string; subject_cn: string; label: string; expires_at: number; created_at: number; revoked_at: number | null; revoke_reason: string | null };
export type CertificateList = { certificates: CertificateRow[]; users: { id: string; user_name: string }[]; issuerReady: boolean; legacyEnabled: boolean };
async function call<T>(suffix = '', body?: unknown): Promise<T> {
  const response = await fetch(`${getApiBase()}/api/admin/certificates${suffix}`, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '证书管理请求失败');
  return data as T;
}
export const listCertificates = () => call<CertificateList>();
export const issueCertificate = (body: { userId: string; label: string; password: string; days: number }) => call<{ fingerprint: string; p12: string; fileName: string }>('/issue', body);
export const registerCertificate = (body: { userId: string; label: string; pem: string }) => call('/register', body);
export const revokeCertificate = (fingerprint: string, reason: string) => call('/revoke', { fingerprint, reason });
