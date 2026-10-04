/** [changmen 扩展] PM only, browser-memory session. Never use the legacy local store. */
export const PM_WALLET_PREFIX = "changmen:pm-wallet:";
// -1 means retain until Chrome clears storage.session; 0 means locked/empty.
const BROWSER_SESSION = -1;
// [changmen 扩展] Production login cookies belong to the API host; local
// development uses the page's /auth proxy. Never accept an API URL from a page.
const BUILT_DEV_ORIGINS = typeof __CHANGMEN_PM_DEV_ORIGINS__ === "undefined" ? [] : __CHANGMEN_PM_DEV_ORIGINS__;
export function isPmWalletStorageKey(key) {
  return typeof key === "string" && key.startsWith(PM_WALLET_PREFIX)
    || Array.isArray(key) && key.some(isPmWalletStorageKey)
    || key && typeof key === "object" && Object.keys(key).some(isPmWalletStorageKey);
}

export function createPmWalletSessionHandler({ chromeApi = globalThis.chrome, fetchFn = globalThis.fetch, now = Date.now,
  devOrigins = BUILT_DEV_ORIGINS } = {}) {
  const trustedDevOrigins = new Set(devOrigins);
  let queue = Promise.resolve();
  const lockEpochs = new Map();
  chromeApi?.alarms?.onAlarm?.addListener(alarm => {
    if (!alarm.name.startsWith(PM_WALLET_PREFIX)) return;
    const result = queue.then(async () => {
      const area = chromeApi?.storage?.session;
      if (!area) return;
      const record = (await area.get(alarm.name))[alarm.name];
      if (record?.expiresAt > 0 && record.expiresAt <= now())
        await area.set({ [alarm.name]: { ...record, revision: crypto.randomUUID(), expiresAt: 0, entries: [] } });
    }).catch(() => {});
    queue = result;
  });
  function scope(message, sender) {
    try { return `${new URL(sender?.url).origin}:${String(message.data?.userId)}`; }
    catch { return "invalid"; }
  }
  async function run(message, sender, epoch) {
    const area = chromeApi?.storage?.session;
    if (!area?.setAccessLevel) return { ok: false, code: "UNSUPPORTED" };
    let origin;
    try { origin = new URL(sender?.url).origin; } catch { return { ok: false, code: "FORBIDDEN" }; }
    const api = origin === "https://changmen.fun" ? "https://api.changmen.fun"
      : trustedDevOrigins.has(origin) ? origin : undefined;
    if (!api || sender?.id || sender?.frameId !== 0 || !sender?.tab?.id)
      return { ok: false, code: "FORBIDDEN" };
    await area.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
    const data = message.data || {};
    const key = `${PM_WALLET_PREFIX}${origin}:${String(data.userId)}`;
    let record = (await area.get(key))[key];
    // A revoke-only capability can clear a session even after backend logout revoked its token.
    if (["pmWalletSession:lock", "pmWalletSession:remove"].includes(message.type)
      && record && data.lockHandle === record.lockHandle) {
      if (message.type.endsWith(":remove") && (!Number.isSafeInteger(data.accountId) || data.accountId <= 0))
        return { ok: false, code: "INVALID_ENTRIES" };
      record = { ...record, revision: crypto.randomUUID(),
        expiresAt: message.type.endsWith(":lock") ? 0 : record.expiresAt,
        entries: message.type.endsWith(":lock") ? [] : record.entries.filter(e => e.accountId !== data.accountId) };
      await area.set({ [key]: record });
      // Revoke-only operations never return private keys.
      return { ok: true, revision: record.revision, expiresAt: record.expiresAt, entries: [] };
    }
    const headers = data.token ? { token: String(data.token) } : { "X-Changmen-Auth": "cookie" };
    const response = await fetchFn(`${api}/auth/pm-wallet-identity`, {
      credentials: "include", cache: "no-store", redirect: "error", headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      const missingAuth = response.status === 401 && failure.code === "AUTH_REQUIRED";
      const revoked = response.status === 401 && ["SESSION_REVOKED", "REFRESH_TOKEN_EXPIRED", "CERT_BIND_FAILED"].includes(failure.code);
      if (revoked && record) {
        await area.set({ [key]: { ...record, revision: crypto.randomUUID(), expiresAt: 0, entries: [] } });
      }
      return { ok: false, code: revoked ? "SESSION_REVOKED" : missingAuth ? "AUTH_REQUIRED" : "AUTH_UNAVAILABLE" };
    }
    const identity = await response.json();
    if (String(identity.userId) !== String(data.userId) || !identity.loginEpoch || !Array.isArray(identity.accounts))
      return { ok: false, code: "IDENTITY_MISMATCH" };
    if (!record || record.loginEpoch !== identity.loginEpoch) {
      record = { revision: crypto.randomUUID(), lockHandle: crypto.randomUUID(), loginEpoch: identity.loginEpoch, expiresAt: 0, entries: [] };
      await area.set({ [key]: record });
    }
    if (["pmWalletSession:lock", "pmWalletSession:remove"].includes(message.type)) {
      if (message.type.endsWith(":remove") && (!Number.isSafeInteger(data.accountId) || data.accountId <= 0))
        return { ok: false, code: "INVALID_ENTRIES" };
      record = { ...record, revision: crypto.randomUUID(),
        expiresAt: message.type.endsWith(":lock") ? 0 : record.expiresAt,
        entries: message.type.endsWith(":lock") ? [] : record.entries.filter(e => e.accountId !== data.accountId) };
      await area.set({ [key]: record });
      return { ok: true, revision: record.revision, expiresAt: record.expiresAt, entries: [] };
    }
    if (epoch !== (lockEpochs.get(scope(message, sender)) || 0)) return { ok: false, code: "LOCKED" };
    if (record.expiresAt > 0 && record.expiresAt <= now()) {
      record = { ...record, revision: crypto.randomUUID(), expiresAt: 0, entries: [] };
      await area.set({ [key]: record });
    }
    const allowed = new Map(identity.accounts.map(a => [Number(a.accountId), String(a.walletAddress).toLowerCase()]));
    const valid = entry => Number.isSafeInteger(entry.accountId) && entry.accountId > 0
      && /^0x[0-9a-f]{40}$/.test(entry.walletAddress)
      && allowed.get(entry.accountId) === entry.walletAddress
      && /^0x[0-9a-fA-F]{64}$/.test(entry.privateKey)
      && typeof entry.binding === "string" && entry.binding.length <= 4096;
    const validEntries = record.entries.filter(valid);
    if (validEntries.length !== record.entries.length) {
      record = { ...record, revision: crypto.randomUUID(), entries: validEntries };
      await area.set({ [key]: record });
    }
    if (message.type === "pmWalletSession:save") {
      if (data.revision !== record.revision) return { ok: false, code: "LOCKED" };
      if (!Array.isArray(data.entries) || data.entries.length > 100 || !data.entries.length || !data.entries.every(valid))
        return { ok: false, code: "INVALID_ENTRIES" };
      if (![0, 1, 4, 8, 24].includes(data.hours)) return { ok: false, code: "INVALID_DURATION" };
      // An existing work session cannot be prolonged by refresh or periodic saves.
      record = { ...record, expiresAt: record.expiresAt || (data.hours === 0 ? BROWSER_SESSION : now() + data.hours * 3600000),
        entries: data.entries.map(({ accountId, walletAddress, privateKey, binding }) => ({ accountId, walletAddress, privateKey, binding })) };
      await area.set({ [key]: record });
      if (record.expiresAt > 0) await chromeApi?.alarms?.create(key, { when: record.expiresAt });
    }
    return { ok: true, revision: record.revision, lockHandle: record.lockHandle, expiresAt: record.expiresAt,
      entries: record.entries.filter(valid) };
  }
  return (message, sender) => {
    const key = scope(message, sender);
    if (["pmWalletSession:lock", "pmWalletSession:remove"].includes(message.type)) lockEpochs.set(key, (lockEpochs.get(key) || 0) + 1);
    const epoch = lockEpochs.get(key) || 0;
    const result = queue.then(() => run(message, sender, epoch)).catch(() => ({ ok: false, code: "UNAVAILABLE" }));
    queue = result.then(() => undefined);
    return result;
  };
}
