import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('./public/matcher_config.js', import.meta.url), 'utf8');
function setup(info, token = '') {
  const window = { location: { pathname: '/matcher/' } };
  const fetch = vi.fn(async () => ({ status: 200, ok: true, json: async () => info }));
  runInNewContext(source, {
    window, fetch, document: { cookie: '' },
    localStorage: { getItem: () => token },
  });
  return window;
}

describe('matcher session requests', () => {
  it('sends CSRF for an existing dual-mode Cookie session without a local JWT', async () => {
    const window = setup({ cookieEnabled: false, csrfToken: 'signed-csrf' });
    expect(await window.matcherSessionHeaders()).toEqual({ 'X-Changmen-Auth': 'cookie', 'X-CSRF-Token': 'signed-csrf' });
  });
  it('preserves legacy JWT requests when no CSRF is issued', async () => {
    expect(await setup({ cookieEnabled: false }, 'jwt').matcherSessionHeaders()).toEqual({ token: 'jwt' });
  });
  it('reports missing CSRF configuration before submitting a Cookie-only mutation', async () => {
    await expect(setup({ cookieEnabled: false }).matcherSessionHeaders()).rejects.toThrow('WEB_AUTH_CSRF_SECRET');
  });
  it('distinguishes request verification from account permissions', () => {
    const window = setup({});
    expect(window.matcherForbiddenMessage({ error: 'CSRF_INVALID' })).toContain('请求校验失败');
    expect(window.matcherForbiddenMessage({ error: 'forbidden' })).toContain('团队长或管理员');
    expect(window.matcherForbiddenMessage({})).not.toContain('管理员');
  });
});
