import { test } from "node:test";
import assert from "node:assert/strict";
import { createPmWalletSessionHandler, isPmWalletStorageKey, PM_WALLET_PREFIX } from "./src/background/pm-wallet-session.js";

const walletAddress = `0x${"1".repeat(40)}`;
const entry = { accountId: 12, walletAddress, privateKey: `0x${"ab".repeat(32)}`, binding: "vault-v1:cipher-v1" };
const sender = { url: "https://changmen.fun/", frameId: 0, tab: { id: 1 } };
function fixture(devOrigins = []) {
  let time = 10000;
  const store = {};
  let identity = { userId: "u", loginEpoch: "login-1", accounts: [{ accountId: 12, walletAddress }] };
  let calls = 0;
  let alarmListener;
  const alarms = new Map();
  const api = { alarms: { onAlarm: { addListener: fn => { alarmListener = fn; } },
    create: async (name, options) => alarms.set(name, options) }, storage: { session: {
    setAccessLevel: async ({ accessLevel }) => assert.equal(accessLevel, "TRUSTED_CONTEXTS"),
    get: async key => ({ [key]: structuredClone(store[key]) }),
    set: async values => Object.assign(store, structuredClone(values)),
  } } };
  let fetchFn = async (url, options) => {
    calls++;
    assert.equal(url, "https://changmen.fun/auth/pm-wallet-identity");
    assert.equal(options.redirect, "error");
    return { ok: true, json: async () => structuredClone(identity) };
  };
  const create = () => createPmWalletSessionHandler({ chromeApi: api, fetchFn: (...args) => fetchFn(...args), now: () => time, devOrigins });
  const handler = create();
  const call = (action, data = {}, source = sender) => handler({ type: `pmWalletSession:${action}`, data: { userId: "u", token: "test-token", ...data } }, source);
  return { call, create, store, api, setTime: n => { time = n; }, setIdentity: i => { identity = i; },
    setFetch: fn => { fetchFn = fn; }, calls: () => calls, alarms, fireAlarm: name => alarmListener({ name }) };
}
async function save(f, hours = 8) {
  const status = await f.call("restore");
  return f.call("save", { revision: status.revision, entries: [entry], hours });
}
test("restore survives a service-worker restart, uses memory only, and cannot extend expiry", async () => {
  const f = fixture();
  const stored = await save(f, 1);
  assert.equal(stored.expiresAt, 3610000);
  const restarted = f.create();
  const restored = await restarted({ type: "pmWalletSession:restore", data: { userId: "u" } }, sender);
  assert.deepEqual(restored.entries, [entry]);
  f.setTime(20000);
  const updated = await f.call("save", { revision: stored.revision, entries: [entry], hours: 8 });
  assert.equal(updated.expiresAt, stored.expiresAt);
  assert.ok(Object.keys(f.store).every(k => k.startsWith(PM_WALLET_PREFIX)));
});
test("rejects foreign websites, frames, other extensions and spoofed user identity", async () => {
  const f = fixture();
  for (const source of [{ ...sender, url: "https://evil.example/" }, { ...sender, frameId: 1 }, { ...sender, id: "other-extension" }])
    assert.equal((await f.call("restore", {}, source)).code, "FORBIDDEN");
  assert.equal(f.calls(), 0);
  assert.equal((await f.call("restore", { userId: "other" })).code, "IDENTITY_MISMATCH");
});

test("supported development entries retain and restore through their own auth proxy", async () => {
  for (const host of ["localhost", "127.0.0.1"]) {
    for (const port of [6107, 6208]) {
      const origin = `http://${host}:${port}`;
      const f = fixture([origin]);
      const source = { ...sender, url: `${origin}/` };
      f.setFetch(async (url, options) => {
        assert.equal(url, `${origin}/auth/pm-wallet-identity`);
        assert.equal(options.credentials, "include");
        assert.equal(options.redirect, "error");
        return { ok: true, json: async () => ({ userId: "u", loginEpoch: "login-1",
          accounts: [{ accountId: 12, walletAddress }] }) };
      });
      const initial = await f.call("restore", {}, source);
      assert.equal(initial.ok, true);
      const saved = await f.call("save", { revision: initial.revision, entries: [entry], hours: 0 }, source);
      assert.equal(saved.ok, true);
      const restored = await f.call("restore", {}, source);
      assert.deepEqual(restored.entries, [entry]);
      assert.equal(restored.expiresAt, saved.expiresAt);
      assert.ok(Object.keys(f.store).every(key => key.startsWith(`${PM_WALLET_PREFIX}${origin}:`)));
    }
  }
});

test("similar hostnames, unapproved ports and message-supplied backend URLs stay forbidden", async () => {
  const f = fixture(["http://localhost:6107", "http://127.0.0.1:6107"]);
  for (const url of ["http://localhost.evil.example:5576/", "http://127.0.0.2:5576/",
    "http://localhost:5274/", "http://localhost:5576/", "https://localhost:6107/"]) {
    const result = await f.call("restore", { apiOrigin: "https://changmen.fun" }, { ...sender, url });
    assert.equal(result.code, "FORBIDDEN");
  }
  assert.equal(f.calls(), 0);
});
test("never falls back to persistent local storage", async () => {
  const handler = createPmWalletSessionHandler({ chromeApi: { storage: { local: { get() { throw Error("local touched"); } } } } });
  assert.equal((await handler({ type: "pmWalletSession:restore" }, sender)).code, "UNSUPPORTED");
});
test("expiry and explicit lock remove private keys, reject stale writes", async () => {
  const f = fixture();
  const saved = await save(f);
  f.setTime(saved.expiresAt);
  const expired = await f.call("restore");
  assert.deepEqual(expired.entries, []);
  assert.equal((await f.call("save", { revision: saved.revision, entries: [entry] })).code, "LOCKED");
  const second = await save(f);
  await f.call("lock", { lockHandle: second.lockHandle });
  assert.equal((await f.call("save", { revision: second.revision, entries: [entry] })).code, "LOCKED");
  assert.ok(Object.values(f.store).every(record => record.entries.length === 0));
});
test("a revoke-only handle works after backend logout, cannot restore keys", async () => {
  const f = fixture();
  const saved = await save(f);
  f.setFetch(async () => ({ ok: false }));
  assert.equal((await f.call("lock", { lockHandle: saved.lockHandle })).ok, true);
  assert.equal((await f.call("restore", { lockHandle: saved.lockHandle })).ok, false);
});
test("login epoch and PM account ownership are checked on every recovery", async () => {
  const f = fixture();
  await save(f);
  f.setIdentity({ userId: "u", loginEpoch: "login-1", accounts: [] });
  assert.deepEqual((await f.call("restore")).entries, []);
  assert.equal((await f.call("save", { revision: (await f.call("restore")).revision, entries: [entry] })).code, "INVALID_ENTRIES");
  f.setIdentity({ userId: "u", loginEpoch: "login-2", accounts: [{ accountId: 12, walletAddress }] });
  assert.deepEqual((await f.call("restore")).entries, []);
});
test("an incoming lock prevents an in-flight save from restoring the session", async () => {
  const f = fixture();
  const status = await f.call("restore");
  let release;
  f.setFetch(() => new Promise(resolve => { release = () => resolve({ ok: true, json: async () => ({ userId: "u", loginEpoch: "login-1", accounts: [{ accountId: 12, walletAddress }] }) }); }));
  const writing = f.call("save", { revision: status.revision, entries: [entry] });
  await new Promise(resolve => setTimeout(resolve, 0));
  const locking = f.call("lock", { lockHandle: status.lockHandle });
  release();
  assert.equal((await writing).code, "LOCKED");
  assert.equal((await locking).ok, true);
});
test("generic storage namespace blocks string/array/default-object access", () => {
  assert.ok(isPmWalletStorageKey(PM_WALLET_PREFIX + "u"));
  assert.ok(isPmWalletStorageKey(["ordinary", PM_WALLET_PREFIX + "u"]));
  assert.ok(isPmWalletStorageKey({ [PM_WALLET_PREFIX + "u"]: null }));
  assert.ok(!isPmWalletStorageKey("PB"));
});
test("an expiry alarm clears stored keys without any webpage or auth request", async () => {
  const f = fixture();
  const saved = await save(f);
  const key = Object.keys(f.store)[0];
  assert.equal(f.alarms.get(key).when, saved.expiresAt);
  const calls = f.calls();
  f.setTime(saved.expiresAt);
  f.fireAlarm(key);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(f.store[key].entries, []);
  assert.equal(f.calls(), calls);
});

test("browser-session mode survives days and worker restarts without an expiry alarm", async () => {
  const f = fixture();
  const saved = await save(f, 0);
  assert.equal(saved.expiresAt, -1);
  assert.equal(f.alarms.size, 0);
  f.setTime(7 * 24 * 3600000);
  const restored = await f.create()({ type: "pmWalletSession:restore", data: { userId: "u" } }, sender);
  assert.deepEqual(restored.entries, [entry]);
  assert.equal(restored.expiresAt, -1);
  // A fresh Chrome session has a fresh storage.session area.
  assert.deepEqual((await fixture().call("restore")).entries, []);
});

test("24-hour mode expires without being extended by subsequent saves", async () => {
  const f = fixture();
  const saved = await save(f, 24);
  assert.equal(saved.expiresAt, 10000 + 24 * 3600000);
  f.setTime(saved.expiresAt - 1);
  assert.equal((await f.call("save", { revision: saved.revision, entries: [entry], hours: 0 })).expiresAt, saved.expiresAt);
  f.setTime(saved.expiresAt);
  assert.deepEqual((await f.call("restore")).entries, []);
});

test("temporary failures and access-token expiry retain storage; confirmed revocation clears it", async () => {
  const f = fixture();
  await save(f, 0);
  for (const [status, code] of [[503, "TEMPORARY_UNAVAILABLE"], [401, "ACCESS_TOKEN_EXPIRED"]]) {
    f.setFetch(async () => ({ ok: false, status, json: async () => ({ code }) }));
    assert.equal((await f.call("restore")).code, "AUTH_UNAVAILABLE");
    assert.deepEqual(Object.values(f.store)[0].entries, [entry]);
  }
  f.setFetch(async () => ({ ok: false, status: 401, json: async () => ({ code: "SESSION_REVOKED" }) }));
  assert.equal((await f.call("restore")).code, "SESSION_REVOKED");
  assert.deepEqual(Object.values(f.store)[0].entries, []);
});

test("removal capability clears only one account and never returns private keys", async () => {
  const f = fixture();
  const second = { ...entry, accountId: 14 };
  f.setIdentity({ userId: "u", loginEpoch: "login-1", accounts: [entry, second] });
  const initial = await f.call("restore");
  const saved = await f.call("save", { revision: initial.revision, entries: [entry, second], hours: 0 });
  const removed = await f.call("remove", { accountId: 12, lockHandle: saved.lockHandle });
  assert.deepEqual(removed.entries, []);
  assert.deepEqual((await f.call("restore")).entries, [second]);
  assert.equal((await f.call("save", { revision: saved.revision, entries: [entry], hours: 0 })).code, "LOCKED");
});
