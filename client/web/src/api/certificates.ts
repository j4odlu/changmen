import { authHeaders } from '@/lib/authSession';
import { getApiBase } from '@/config/apiBase';
export type CertificateRow = {
  fingerprint: string; user_id: string; user_name: string; serial: string; subject_cn: string; label: string;
  not_before: number; expires_at: number; created_at: number; revoked_at: number | null; revoke_reason: string | null;
  replaces_fingerprint: string | null; active_sessions: number; last_browser_activity: number | null;
};
export type AuthorityCertificate = { subject: string; fingerprint: string; notBefore: number; expiresAt: number; pem: string };
export type CertificateList = { certificates: CertificateRow[]; users: { id: string; user_name: string }[]; issuerReady: boolean; legacyEnabled: boolean;
  currentFingerprint: string; authority: { ready: boolean; root: AuthorityCertificate | null; issuer: AuthorityCertificate | null } };
export type CertificateDetail = { certificate: CertificateRow & { certificate_pem: string }; audit: { id: number; operation: string; created_at: number; actor_name: string | null; details: Record<string, unknown> }[] };
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
export const certificateDetail = (fingerprint: string) => call<CertificateDetail>(`/detail?fingerprint=${encodeURIComponent(fingerprint)}`);
export const issueCertificate = (body: { userId: string; label: string; password: string; days: number; purpose?: string; replacesFingerprint?: string }) => call<{ fingerprint: string; p12: string; fileName: string }>('/issue', body);
export const registerCertificate = (body: { userId: string; label: string; pem: string }) => call('/register', body);
export const updateCertificateLabel = (fingerprint: string, label: string) => call('/label', { fingerprint, label });
export const revokeCertificate = (fingerprint: string, reason: string) => call('/revoke', { fingerprint, reason });
export const revokeCertificates = (fingerprints: string[], reason: string) => call<{ revoked: number; unchanged: number }>('/revoke-batch', { fingerprints, reason });
