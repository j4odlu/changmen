/** [changmen 扩展] PM work-session recovery. No password/KEK, no PredictFun keys. */
import { reactive } from "vue";
import { a8PluginSend } from "@changmen/client-core/chrome-plugin/bridge";
import type { PlatformAccount } from "@/models/platformAccount";
import { getAuthSessionVersion, getToken, isAuthSessionCurrent } from "@/lib/authSession";
import { extractPrivateKeyFromToken, isPolymarketProvider, mergePrivateKeyIntoToken, tokenWalletAddress, toPersistTokenForProvider } from "./tokenStrip";
import { getVaultMeta, listVaultKeys } from "./store";

const PREF_KEY = "changmen:pm-session-enabled";
const HOURS_KEY = "changmen:pm-session-hours";
const LOCK_EVENT = "changmen:pm-session-lock";
const REVOKE_PREFIX = "changmen:pm-revoke-pending:";
const revokeTimers = new Map<string, ReturnType<typeof setTimeout>>();
const revokeRequests = new Map<string, Promise<boolean>>();
interface Entry { accountId: number; walletAddress: string; privateKey: string; binding: string }
interface Reply { ok?: boolean; code?: string; revision?: string; lockHandle?: string; expiresAt?: number; entries?: Entry[] }
let cache: { userId: string; authVersion: string; revision: string; expiresAt: number; entries: Entry[] } | null = null;
let accountsRef: PlatformAccount[] = [];
// Cleanup retains all object references; eligibility uses the latest account per ID.
const currentPmAccounts = new Map<number, PlatformAccount>();
let epoch = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
let saveRevision: { userId: string; authVersion: string; revision: string } | null = null;
let cleanupKeys: (ids: number[], wallets: string[]) => void = () => {};
let clearSignerCache: () => void = () => {};
let pending: Promise<boolean> | null = null;
let saveSequence = 0;
let lastUserId = "";
const enabled = typeof localStorage !== "undefined" && localStorage.getItem(PREF_KEY) !== "0";
const storedHours = typeof localStorage !== "undefined" ? Number(localStorage.getItem(HOURS_KEY)) : 0;
export const retainedPmSessionUi = reactive({ enabled, hours: [0, 1, 4, 8, 24].includes(storedHours) ? storedHours : 0,
  expiresAt: 0, active: false, lockPending: false, error: "" });
const REVOKE_ERROR = "本页已锁定，但插件撤销尚未确认；已禁止会话恢复，正在重试";
function pendingRevoke(userId: string) { return localStorage.getItem(`${REVOKE_PREFIX}${userId}`); }
async function confirmRevocation(userId: string): Promise<boolean> {
  if (revokeRequests.has(userId)) return revokeRequests.get(userId)!;
  const marker = pendingRevoke(userId);
  if (!marker) return true;
  const oldTimer = revokeTimers.get(userId);
  if (oldTimer) clearTimeout(oldTimer);
  revokeTimers.delete(userId);
  const request = (async () => {
    const reply = await send("lock", userId);
    if (pendingRevoke(userId) !== marker) return false;
    if (reply.ok) {
      localStorage.removeItem(`${REVOKE_PREFIX}${userId}`);
      if (lastUserId === userId) {
        retainedPmSessionUi.lockPending = false;
        if (retainedPmSessionUi.error === REVOKE_ERROR) retainedPmSessionUi.error = "";
      }
      return true;
    }
    if (lastUserId === userId) {
      retainedPmSessionUi.lockPending = true;
      retainedPmSessionUi.error = REVOKE_ERROR;
    }
    revokeTimers.set(userId, setTimeout(() => {
      revokeTimers.delete(userId);
      void confirmRevocation(userId);
    }, 15000));
    return false;
  })().finally(() => {
    revokeRequests.delete(userId);
    // A second lock may replace the marker while the first request is in flight.
    if (pendingRevoke(userId) && !revokeTimers.has(userId)) {
      revokeTimers.set(userId, setTimeout(() => {
        revokeTimers.delete(userId);
        void confirmRevocation(userId);
      }, 15000));
    }
  });
  revokeRequests.set(userId, request);
  return request;
}

export function registerRetainedPmCleanup(fn: typeof cleanupKeys) { cleanupKeys = fn; }
function binding(meta: unknown, row: unknown) { return JSON.stringify([meta, row]); }
function address(account: PlatformAccount) {
  return tokenWalletAddress(account.token);
}
function trackAccounts(accounts: PlatformAccount[], userId: string) {
  if (lastUserId && lastUserId !== userId) {
    clearRetainedPmMemory();
    retainedPmSessionUi.error = "";
    accountsRef = [];
  }
  // A single-account precheck must not drop the other PM accounts from lock cleanup.
  accountsRef = [...new Set([...accountsRef, ...accounts])];
  for (const account of accounts) {
    if (isPolymarketProvider(account.provider)) currentPmAccounts.set(Number(account.accountId), account);
  }
  lastUserId = userId;
  retainedPmSessionUi.lockPending = Boolean(pendingRevoke(userId));
  if (retainedPmSessionUi.lockPending) {
    retainedPmSessionUi.error = REVOKE_ERROR;
    void confirmRevocation(userId);
  }
}
function expired(deadline: number) { return deadline === 0 || deadline > 0 && deadline <= Date.now(); }
function pollDelay(deadline: number) { return deadline > 0 ? Math.min(15000, Math.max(1, deadline - Date.now())) : 15000; }
function scheduleSessionCheck() {
  if (timer) clearTimeout(timer);
  timer = cache?.entries.length ? setTimeout(() => void checkSession(), pollDelay(cache.expiresAt)) : undefined;
}
async function send(action: "restore" | "save" | "lock" | "remove", userId: string, extra: Record<string, unknown> = {}): Promise<Reply> {
  // Older extensions can leave unknown actions unanswered. Always fail back to password unlock.
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const at = epoch;
  const version = getAuthSessionVersion();
  try {
    const reply = await Promise.race([
      a8PluginSend({ type: `pmWalletSession:${action}`, data: { userId, token: getToken() || "",
        ...(["lock", "remove"].includes(action) ? { lockHandle: localStorage.getItem(`changmen:pm-lock:${userId}`) || "" } : {}), ...extra } }) as Promise<Reply>,
      new Promise<Reply>(resolve => { timeout = setTimeout(() => resolve({ ok: false, code: "TIMEOUT" }), 6500); }),
    ]) || {};
    if (action !== "lock" && !reply.ok && at === epoch && isAuthSessionCurrent(version)) {
      const reasons: Record<string, string> = {
        FORBIDDEN: "当前网页地址未获插件授权；开发端口变更后，请重新构建并加载插件",
        UNSUPPORTED: "当前插件不支持 PM 会话保持，请更新并重新加载插件",
        AUTH_UNAVAILABLE: "登录身份核验失败，请检查登录状态和网页 /auth 代理",
        IDENTITY_MISMATCH: "插件核验的登录身份不匹配，请重新登录",
        TIMEOUT: "插件响应超时，请检查插件版本并重新加载",
        UNAVAILABLE: "插件会话服务暂不可用，请检查后端连接",
        LOCKED: "PM 会话已锁定，请重新解锁",
        SESSION_REVOKED: "登录会话已撤销，请重新登录并解锁",
      };
      retainedPmSessionUi.error = reasons[reply.code || ""] || "PM 会话保持失败，请检查插件版本与连接";
    }
    return reply;
  } catch {
    if (action !== "lock" && at === epoch && isAuthSessionCurrent(version)) retainedPmSessionUi.error = "无法连接 PM 插件，请确认已安装并重新加载最新插件";
    return { ok: false, code: "PLUGIN_UNAVAILABLE" };
  }
  finally { if (timeout) clearTimeout(timeout); }
}
export function clearRetainedPmMemory() {
  epoch += 1;
  if (timer) clearTimeout(timer);
  if (expiryTimer) clearTimeout(expiryTimer);
  timer = undefined;
  expiryTimer = undefined;
  saveRevision = null;
  const entries = cache?.entries || [];
  cache = null;
  retainedPmSessionUi.active = false;
  retainedPmSessionUi.expiresAt = 0;
  const pmAccounts = accountsRef.filter(a => isPolymarketProvider(a.provider));
  cleanupKeys([...new Set([...entries.map(e => e.accountId), ...pmAccounts.map(a => Number(a.accountId))])],
    [...new Set([...entries.map(e => e.walletAddress), ...pmAccounts.map(address)])]);
  for (const account of accountsRef) {
    if (!isPolymarketProvider(account.provider)) continue;
    account.token = toPersistTokenForProvider(account.provider, account.token);
    account.balance = undefined;
  }
  clearSignerCache();
  accountsRef = [];
  currentPmAccounts.clear();
}
export function getRetainedPmPrivateKey(accountId: number, userId?: string, walletAddress?: string): string | undefined {
  if (!cache) return undefined;
  if (expired(cache.expiresAt) || !isAuthSessionCurrent(cache.authVersion)) { clearRetainedPmMemory(); return undefined; }
  if (userId && userId !== cache.userId) return undefined;
  if (pendingRevoke(cache.userId)) return undefined;
  const entry = cache.entries.find(e => e.accountId === Number(accountId));
  if (walletAddress !== undefined && entry?.walletAddress !== walletAddress.trim().toLowerCase()) return undefined;
  return entry?.privateKey;
}
function accept(reply: Reply, userId: string, version: string, entries: Entry[]) {
  if (reply.lockHandle) localStorage.setItem(`changmen:pm-lock:${userId}`, reply.lockHandle);
  cache = { userId, authVersion: version, revision: reply.revision!, expiresAt: reply.expiresAt!, entries };
  retainedPmSessionUi.active = entries.length > 0;
  retainedPmSessionUi.expiresAt = cache.expiresAt;
  retainedPmSessionUi.error = "";
  for (const account of accountsRef) {
    if (!isPolymarketProvider(account.provider)) continue;
    const entry = entries.find(e => e.accountId === Number(account.accountId) && e.walletAddress === address(account));
    if (entry) account.token = mergePrivateKeyIntoToken(account.token, entry.privateKey, account.provider);
  }
  void import("@changmen/venue-adapter/polymarket").then(m => {
    clearSignerCache = m.clearPolymarketOrderClientCache;
    if (!cache) clearSignerCache();
  }).catch(() => {});
  if (timer) clearTimeout(timer);
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = cache.expiresAt > 0 ? setTimeout(clearRetainedPmMemory, Math.max(1, cache.expiresAt - Date.now())) : undefined;
  scheduleSessionCheck();
}
/** Capture the extension generation before starting a password unlock/import. */
export async function prepareRetainedPmSession(userId: string) {
  if (!retainedPmSessionUi.enabled) return;
  lastUserId = userId;
  if (pendingRevoke(userId) && !await confirmRevocation(userId)) return;
  const at = epoch;
  const version = getAuthSessionVersion();
  const reply = await send("restore", userId);
  if (reply.ok && reply.revision && at === epoch && isAuthSessionCurrent(version)) {
    retainedPmSessionUi.error = "";
    saveRevision = { userId, authVersion: version, revision: reply.revision };
    if (reply.lockHandle) localStorage.setItem(`changmen:pm-lock:${userId}`, reply.lockHandle);
  }
}
async function checkSession() {
  const current = cache;
  if (!current) return;
  if (expired(current.expiresAt) || !isAuthSessionCurrent(current.authVersion)) { clearRetainedPmMemory(); return; }
  const at = epoch;
  const reply = await send("restore", current.userId);
  if (at !== epoch || cache !== current) return;
  if (!reply.ok) {
    if (["SESSION_REVOKED", "IDENTITY_MISMATCH", "LOCKED"].includes(reply.code || "")) clearRetainedPmMemory();
    else scheduleSessionCheck();
    return;
  }
  if (reply.expiresAt !== current.expiresAt || !reply.revision) { clearRetainedPmMemory(); return; }
  const allowed = new Set((reply.entries || []).map(e => `${e.accountId}:${e.walletAddress}:${e.binding}`));
  const removed = current.entries.filter(e => !allowed.has(`${e.accountId}:${e.walletAddress}:${e.binding}`)).map(e => e.accountId);
  if (removed.length) pruneAccounts(removed);
  current.revision = reply.revision;
  retainedPmSessionUi.error = "";
  scheduleSessionCheck();
}
export async function restoreRetainedPmSession(accounts: PlatformAccount[], userId: string): Promise<boolean> {
  trackAccounts(accounts, userId);
  if (!retainedPmSessionUi.enabled || !userId) return false;
  if (pendingRevoke(userId)) {
    await confirmRevocation(userId);
    // Always require password unlock after an unconfirmed explicit lock.
    return false;
  }
  lastUserId = userId;
  const version = getAuthSessionVersion();
  const at = epoch;
  const sequence = saveSequence;
  const reply = await send("restore", userId);
  if (at === epoch && isAuthSessionCurrent(version) && !reply.ok
    && ["SESSION_REVOKED", "IDENTITY_MISMATCH", "LOCKED"].includes(reply.code || "")) clearRetainedPmMemory();
  if (at !== epoch || !isAuthSessionCurrent(version) || !reply.ok || !reply.revision || typeof reply.expiresAt !== "number" || expired(reply.expiresAt)) return false;
  const meta = await getVaultMeta(userId);
  const rows = await listVaultKeys(userId);
  const entries = (reply.entries || []).filter(entry => {
    const account = currentPmAccounts.get(entry.accountId);
    return account && address(account) === entry.walletAddress
      && rows.some(row => Number(row.accountId) === entry.accountId && binding(meta, row) === entry.binding)
      && /^0x[0-9a-fA-F]{64}$/.test(entry.privateKey);
  });
  if (!entries.length || at !== epoch || sequence !== saveSequence || !isAuthSessionCurrent(version)) return false;
  accept(reply, userId, version, entries);
  return accounts.some(account => isPolymarketProvider(account.provider)
    && entries.some(entry => entry.accountId === Number(account.accountId) && entry.walletAddress === address(account)));
}
export async function saveRetainedPmSession(accounts: PlatformAccount[], userId: string): Promise<boolean> {
  trackAccounts(accounts, userId);
  if (!retainedPmSessionUi.enabled || !userId) return false;
  if (pendingRevoke(userId)) return false;
  if (!accounts.some(a => isPolymarketProvider(a.provider) && extractPrivateKeyFromToken(a.token))) return false;
  lastUserId = userId;
  const at = epoch;
  const version = getAuthSessionVersion();
  const sequence = ++saveSequence;
  // Snapshot before enqueueing: an older response must not overwrite a newer save.
  const snapshot = accounts.map(a => ({ accountId: a.accountId, provider: a.provider, token: a.token } as PlatformAccount));
  const hours = retainedPmSessionUi.hours;
  const previous = pending;
  const task = (async () => {
    if (previous) await previous;
    if (at !== epoch || !isAuthSessionCurrent(version)) return false;
    const meta = await getVaultMeta(userId);
    const rows = await listVaultKeys(userId);
    const entries: Entry[] = [];
    for (const account of snapshot) {
      if (!isPolymarketProvider(account.provider)) continue;
      const privateKey = extractPrivateKeyFromToken(account.token);
      const row = rows.find(r => Number(r.accountId) === Number(account.accountId));
      const walletAddress = address(account);
      if (privateKey && row && /^0x[0-9a-f]{40}$/.test(walletAddress))
        entries.push({ accountId: Number(account.accountId), walletAddress, privateKey, binding: binding(meta, row) });
    }
    if (!entries.length || at !== epoch || !isAuthSessionCurrent(version)) return false;
    const revision = cache?.userId === userId && cache.authVersion === version ? cache.revision
      : saveRevision?.userId === userId && saveRevision.authVersion === version ? saveRevision.revision : "";
    if (!revision || at !== epoch || !isAuthSessionCurrent(version)) return false;
    const reply = await send("save", userId, { revision, entries, hours });
    if (!reply.ok || typeof reply.expiresAt !== "number" || expired(reply.expiresAt) || !reply.revision || at !== epoch || !isAuthSessionCurrent(version)) return false;
    if (sequence === saveSequence) accept(reply, userId, version, entries);
    return true;
  })().catch(() => false).finally(() => { if (pending === task) pending = null; });
  pending = task;
  const ok = await task;
  if (!ok && !retainedPmSessionUi.error) retainedPmSessionUi.error = "PM 会话未保持，刷新后使用密码解锁";
  return ok;
}
export async function revokeRetainedPmSession(userId?: string): Promise<boolean> {
  const uid = userId || cache?.userId || saveRevision?.userId || lastUserId;
  if (uid) {
    lastUserId = uid;
    localStorage.setItem(`${REVOKE_PREFIX}${uid}`, `${Date.now()}:${Math.random()}`);
    retainedPmSessionUi.lockPending = true;
    retainedPmSessionUi.error = REVOKE_ERROR;
  }
  clearRetainedPmMemory();
  if (typeof localStorage !== "undefined") localStorage.setItem(LOCK_EVENT, `${Date.now()}:${Math.random()}`);
  return uid ? confirmRevocation(uid) : true;
}
export async function setRetainedPmEnabled(value: boolean, userId?: string) {
  retainedPmSessionUi.enabled = value;
  localStorage.setItem(PREF_KEY, value ? "1" : "0");
  if (!value) return revokeRetainedPmSession(userId);
  return true;
}
export function setRetainedPmHours(hours: number) {
  retainedPmSessionUi.hours = [0, 1, 4, 8, 24].includes(hours) ? hours : 0;
  localStorage.setItem(HOURS_KEY, String(retainedPmSessionUi.hours));
}
function pruneAccounts(ids: number[]) {
  epoch += 1;
  for (const id of ids) currentPmAccounts.delete(id);
  const removed = cache?.entries.filter(e => ids.includes(e.accountId)) || [];
  if (cache) cache.entries = cache.entries.filter(e => !ids.includes(e.accountId));
  const affected = accountsRef.filter(a => isPolymarketProvider(a.provider) && ids.includes(Number(a.accountId)));
  cleanupKeys(ids, [...new Set([...removed.map(e => e.walletAddress), ...affected.map(address)])]);
  for (const account of affected) {
    account.token = toPersistTokenForProvider(account.provider, account.token);
    account.balance = undefined;
  }
  accountsRef = accountsRef.filter(a => !affected.includes(a));
  retainedPmSessionUi.active = Boolean(cache?.entries.length);
  clearSignerCache();
  // Invalidating an in-flight poll must still leave a poll for the surviving keys.
  scheduleSessionCheck();
}
/** Revoke only this account, including other tabs and stale in-flight saves. */
export async function removeRetainedPmAccount(userId: string, accountId: number) {
  pruneAccounts([accountId]);
  const at = epoch;
  const version = getAuthSessionVersion();
  localStorage.setItem(LOCK_EVENT, JSON.stringify({ userId, accountId, nonce: Math.random() }));
  const reply = await send("remove", userId, { accountId });
  if (reply.ok && reply.revision && at === epoch && isAuthSessionCurrent(version)) {
    saveRevision = { userId, authVersion: version, revision: reply.revision };
    if (cache?.userId === userId) cache.revision = reply.revision;
  }
}
if (typeof window !== "undefined") {
  window.addEventListener("storage", event => {
    if (event.key === PREF_KEY) {
      retainedPmSessionUi.enabled = event.newValue !== "0";
      if (!retainedPmSessionUi.enabled) clearRetainedPmMemory();
      return;
    }
    if (event.key === HOURS_KEY) {
      const hours = Number(event.newValue);
      retainedPmSessionUi.hours = [0, 1, 4, 8, 24].includes(hours) ? hours : 0;
      return;
    }
    if (event.key === `${REVOKE_PREFIX}${lastUserId}`) {
      retainedPmSessionUi.lockPending = Boolean(event.newValue);
      if (event.newValue) {
        clearRetainedPmMemory();
        retainedPmSessionUi.error = REVOKE_ERROR;
      } else if (retainedPmSessionUi.error === REVOKE_ERROR) retainedPmSessionUi.error = "";
      return;
    }
    if (event.key === LOCK_EVENT) {
      try {
        const removal = JSON.parse(event.newValue || "");
        if (removal.userId === lastUserId && Number.isSafeInteger(removal.accountId)) {
          pruneAccounts([removal.accountId]);
          return;
        }
        if (removal.accountId) return;
      } catch { /* Full-session lock uses a non-JSON nonce. */ }
    }
    if (event.key === LOCK_EVENT || event.key === "app:session-version") {
      clearRetainedPmMemory();
    }
  });
}
