import { describe, expect, it } from 'vitest';
import type { CertificateRow } from '@/api/certificates';
import { certificateCsv, certificateState, filterCertificates } from './certificateManagement';
const now = 1800000000000;
const row = (patch: Partial<CertificateRow> = {}): CertificateRow => ({ fingerprint: 'a'.repeat(64), user_id: 'u1', user_name: 'River', serial: '01', subject_cn: 'CN-old', label: '办公室', not_before: now-1000, expires_at: now+90*86400000, created_at: now-1000, revoked_at: null, revoke_reason: null, replaces_fingerprint: null, active_sessions: 0, last_browser_activity: null, ...patch });
describe('certificate administration filters and export', () => {
  it('prioritizes revocation and handles exact expiry and warning boundaries', () => {
    expect(certificateState(row(),now)).toBe('valid');
    expect(certificateState(row({ expires_at:now+30*86400000 }),now)).toBe('expiring');
    expect(certificateState(row({ expires_at:now }),now)).toBe('expired');
    expect(certificateState(row({ not_before:now+1 }),now)).toBe('pending');
    expect(certificateState(row({ expires_at:now-1, revoked_at:now-1 }),now)).toBe('revoked');
  });
  it('combines text, owner and status rather than exposing rows from another user filter', () => {
    const rows=[row(),row({ user_id:'u2',user_name:'Other',expires_at:now-1 })];
    expect(filterCertificates(rows,'river','u1','valid',now)).toHaveLength(1);
    expect(filterCertificates(rows,'river','u2','',now)).toHaveLength(0);
    expect(filterCertificates(rows,'','u2','expired',now)).toHaveLength(1);
    expect(filterCertificates(rows,'AAAA','','',now)).toHaveLength(2);
  });
  it('exports public metadata with proper CSV escaping and neutralizes spreadsheet formulas', () => {
    const csv=certificateCsv([row({ label:'=HYPERLINK("evil")',revoke_reason:'reason,"quote"\nnext' })],now);
    expect(csv).toContain('"\'=HYPERLINK(""evil"")"');
    expect(csv).toContain('reason,""quote""\nnext');
    expect(csv).not.toContain('PRIVATE KEY');expect(csv).not.toContain('certificate_pem');
  });
});
