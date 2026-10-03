import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAdminUserOnboarding } from './useAdminUserOnboarding';
const api = vi.hoisted(() => ({ createAdminUser: vi.fn(), issueCertificate: vi.fn() }));
vi.mock('@/api/admin', () => ({ createAdminUser: api.createAdminUser }));
vi.mock('@/api/certificates', () => ({ issueCertificate: api.issueCertificate }));
const user = { id: 'immutable-new-user', userName: 'new-user' };
const bundle = { fingerprint: 'public-fingerprint', p12: 'encrypted-test-package', fileName: 'test.p12' };
function flow() {
  const notify = vi.fn(); const value = useAdminUserOnboarding(notify);
  Object.assign(value.form, { userName: ' new-user ', password: 'test-only-password', confirm: 'test-only-password', packagePassword: 'test-only-package-password', label: 'first-device' });
  return { ...value, notify };
}
beforeEach(() => { vi.resetAllMocks(); api.createAdminUser.mockResolvedValue(user); api.issueCertificate.mockResolvedValue(bundle); });
describe('new user certificate onboarding', () => {
  it('defaults to issuance, creates first and signs against the returned immutable identity', async () => {
    const f = flow(); expect(f.form.issue).toBe(true); expect(await f.submit()).toBe(true);
    expect(api.createAdminUser).toHaveBeenCalledWith('new-user', 'test-only-password');
    expect(api.issueCertificate).toHaveBeenCalledWith({ userId: user.id, label: 'first-device', password: 'test-only-package-password', days: 180, purpose: 'ISSUE' });
    expect(f.notify).toHaveBeenCalledOnce(); expect(f.packageData.value).toEqual(bundle);
    expect(f.form.password).toBe(''); expect(f.form.confirm).toBe(''); expect(f.form.packagePassword).toBe('');
    expect(await f.submit()).toBe(false); expect(api.issueCertificate).toHaveBeenCalledOnce();
  });
  it('validates certificate inputs before creating an otherwise unusable user', async () => {
    const f = flow(); f.form.packagePassword = 'short'; expect(await f.submit()).toBe(false);
    expect(api.createAdminUser).not.toHaveBeenCalled(); expect(f.created.value).toBeNull();
    f.form.packagePassword = 'test-only-package-password'; f.form.days = 0;
    expect(await f.submit()).toBe(false); expect(api.createAdminUser).not.toHaveBeenCalled();
  });
  it('does not sign when account creation fails', async () => {
    api.createAdminUser.mockRejectedValueOnce(new Error('username taken')); const f = flow();
    expect(await f.submit()).toBe(false); expect(api.issueCertificate).not.toHaveBeenCalled(); expect(f.notify).not.toHaveBeenCalled();
  });
  it('keeps the created user after issuance failure and retries only the certificate operation', async () => {
    api.issueCertificate.mockRejectedValueOnce(new Error('issuer unavailable')); const f = flow();
    expect(await f.submit()).toBe(false); expect(f.created.value).toEqual(user); expect(f.error.value).toBe('issuer unavailable');
    expect(f.form.password).toBe(''); f.form.userName = 'other-name';
    expect(await f.submit()).toBe(true); expect(api.createAdminUser).toHaveBeenCalledOnce(); expect(f.notify).toHaveBeenCalledOnce();
    expect(api.issueCertificate).toHaveBeenLastCalledWith(expect.objectContaining({ userId: user.id }));
  });
  it('allows explicit account-only creation without installation credentials', async () => {
    const f = flow(); f.form.issue = false; f.form.packagePassword = '';
    expect(await f.submit()).toBe(true); expect(api.issueCertificate).not.toHaveBeenCalled(); expect(f.packageData.value).toBeNull();
  });
  it('prevents concurrent submissions and captures settings before the create request finishes', async () => {
    let finish!: (value: typeof user) => void;
    api.createAdminUser.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); const f = flow();
    const pending = f.submit(); expect(await f.submit()).toBe(false); f.form.issue = false; f.form.label = 'changed';
    finish(user); expect(await pending).toBe(true); expect(api.createAdminUser).toHaveBeenCalledOnce();
    expect(api.issueCertificate).toHaveBeenCalledWith(expect.objectContaining({ label: 'first-device' }));
  });
  it('clears secrets on close and does not issue after disposal while user creation is pending', async () => {
    let finish!: (value: typeof user) => void;
    api.createAdminUser.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); const f = flow();
    const pending = f.submit(); f.dispose(); finish(user);
    expect(await pending).toBe(false); expect(api.issueCertificate).not.toHaveBeenCalled();
    expect(f.created.value).toBeNull(); expect(f.form.password).toBe(''); expect(f.form.packagePassword).toBe('');
  });
});
