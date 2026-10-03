import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRenderer, h, nextTick, ssrContextKey } from 'vue';
import type { CertificateRow } from '@/api/certificates';
import Panel from './CertificateManagerPanel.vue';
const api = vi.hoisted(() => ({ listCertificates: vi.fn(), issueCertificate: vi.fn(), registerCertificate: vi.fn(), certificateDetail: vi.fn(), updateCertificateLabel: vi.fn(), revokeCertificates: vi.fn() }));
vi.mock('@/api/certificates', () => api);
vi.mock('element-plus', () => ({ ElMessage: { error: vi.fn(), warning: vi.fn(), success: vi.fn() }, ElMessageBox: { prompt: vi.fn() } }));
vi.mock('element-plus/es/components/alert/style/css', () => ({}));
vi.mock('element-plus/es/components/input/style/css', () => ({}));
vi.mock('element-plus/es/components/select/style/css', () => ({}));
vi.mock('element-plus/es/components/option/style/css', () => ({}));
vi.mock('element-plus/es/components/button/style/css', () => ({}));
vi.mock('element-plus/es/components/tag/style/css', () => ({}));
vi.mock('element-plus/es/components/table/style/css', () => ({}));
vi.mock('element-plus/es/components/table-column/style/css', () => ({}));
vi.mock('element-plus/es/components/pagination/style/css', () => ({}));
vi.mock('element-plus/es/components/collapse/style/css', () => ({}));
vi.mock('element-plus/es/components/collapse-item/style/css', () => ({}));
vi.mock('element-plus/es/components/dialog/style/css', () => ({}));
vi.mock('element-plus/es/components/form/style/css', () => ({}));
vi.mock('element-plus/es/components/form-item/style/css', () => ({}));
vi.mock('element-plus/es/components/input-number/style/css', () => ({}));
vi.mock('element-plus/es/components/drawer/style/css', () => ({}));
vi.mock('element-plus/es/components/descriptions/style/css', () => ({}));
vi.mock('element-plus/es/components/descriptions-item/style/css', () => ({}));
vi.mock('element-plus/es/components/timeline/style/css', () => ({}));
vi.mock('element-plus/es/components/timeline-item/style/css', () => ({}));
vi.mock('element-plus/es/components/empty/style/css', () => ({}));
vi.mock('element-plus/es/components/loading/style/css', () => ({}));
vi.mock('element-plus/es/components/message/style/css', () => ({}));
vi.mock('element-plus/es/components/message-box/style/css', () => ({}));
vi.mock('element-plus/es/components/base/style/css', () => ({}));
vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn() }));
type Host = { children: Host[]; parent: Host | null };
const node = (): Host => ({ children: [], parent: null });
const renderer = createRenderer<Host, Host>({
  createElement: node, createText: node, createComment: node,
  insert(child, parent) { child.parent = parent; parent.children.push(child); },
  remove(child) { if (child.parent) child.parent.children = child.parent.children.filter(c => c !== child); },
  setText() {}, setElementText() {}, patchProp() {},
  parentNode: child => child.parent, nextSibling: () => null,
});
const now = Date.now();
const row = (userId: string): CertificateRow => ({ fingerprint: userId.repeat(64), user_id: userId, user_name: userId, serial: userId, subject_cn: userId, label: '', not_before: now-1000, expires_at: now+90*86400000, created_at: now, revoked_at: null, revoke_reason: null, replaces_fingerprint: null, active_sessions: 0, last_browser_activity: null });
const apps: ReturnType<typeof renderer.createApp>[] = [];
async function mount(userId?: string) {
  // Use Vue's renderer with a minimal host to exercise the real setup/lifecycle without a browser.
  const app = renderer.createApp({ ...Panel, render: () => h('div') }, { userId, userName: userId });
  app.provide(ssrContextKey, {});
  apps.push(app);
  const vm = app.mount(node());
  await Promise.resolve(); await nextTick();
  return { state: (vm.$ as unknown as { setupState: Record<string, any> }).setupState, vm };
}
beforeEach(() => {
  vi.resetAllMocks();
  api.listCertificates.mockResolvedValue({ certificates: [row('a'), row('b')], users: [{ id: 'a', user_name: 'a' }, { id: 'b', user_name: 'b' }], issuerReady: true, currentFingerprint: '', authority: { root: null, issuer: null } });
  api.issueCertificate.mockResolvedValue({ fileName: 'test.p12', p12: '', fingerprint: 'test' });
});
afterEach(() => { for (const app of apps.splice(0)) app.unmount(); });
describe('embedded certificate user isolation', () => {
  it('limits rows, totals and owner options to the immutable user even if the global filter changes', async () => {
    const { state } = await mount('a');
    expect(state.scopedUsers.map((u: { id: string }) => u.id)).toEqual(['a']);
    expect(state.counts.total).toBe(1);
    state.filterUser = 'b';
    expect(state.filtered.map((r: CertificateRow) => r.user_id)).toEqual(['a']);
    state.query = 'b'; expect(state.filtered).toEqual([]);
    const global = await mount(); expect(global.state.counts.total).toBe(2);
  });
  it('prefills signing and import ownership and refuses foreign-row operations or changed ownership', async () => {
    const { state } = await mount('a');
    state.openForm('ISSUE'); expect(state.userId).toBe('a');
    state.userId = 'b'; await state.submit(); expect(api.issueCertificate).not.toHaveBeenCalled();
    state.openForm('REGISTER'); expect(state.userId).toBe('a');
    state.pem = 'public test'; await state.submit(); expect(api.registerCertificate).toHaveBeenCalledWith(expect.objectContaining({ userId: 'a' }));
    state.openForm('RENEW', row('b')); expect(state.previous).toBeNull();
    await state.showDetail(row('b')); await state.editLabel(row('b')); await state.revoke([row('b')]);
    expect(api.certificateDetail).not.toHaveBeenCalled(); expect(api.updateCertificateLabel).not.toHaveBeenCalled(); expect(api.revokeCertificates).not.toHaveBeenCalled();
  });
  it('blocks leaving during issuance and until the installation package is saved and closed', async () => {
    const { state, vm } = await mount('a');
    state.openForm('ISSUE'); state.password = 'test-password-only';
    let finish!: (value: unknown) => void;
    api.issueCertificate.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const pending = state.submit(); expect((vm as any).canLeave()).toBe(false);
    finish({ fileName: 'test.p12', p12: '', fingerprint: 'test' }); await pending;
    expect(api.issueCertificate).toHaveBeenCalledWith(expect.objectContaining({ userId: 'a' }));
    expect((vm as any).canLeave()).toBe(false);
    state.packageOpen = false; state.clearPackage(); expect((vm as any).canLeave()).toBe(true);
    apps[0].unmount(); apps.splice(0, 1);
    expect(state.packageData).toBeNull(); expect(state.password).toBe('');
  });
});
