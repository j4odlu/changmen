import type { CookieSessionInfo } from "@/lib/authSession";
import { browserAuthState, clearAuthSession, getAuthSessionVersion, getCookieSessionInfo, invalidateAuthSession, isAuthSessionCurrent, isAuthTransitionPending, isCookieAuthMode, setCookieAuthMode, setCookieSessionInfo } from "@/lib/authSession";
import { getApiBase } from "@/config/apiBase";
import { resolveChangmenWsBase } from "@changmen/venue-adapter/shared";
import { SessionRestoreConfigurationError } from "@/lib/sessionRestoreError";
import { withAuthLock } from "@/lib/authLock";

let pending: { version: string; task: Promise<boolean> } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let watching = false;
let failures = 0;
let renewedVersion = "";
let renewedAt = 0;

/** Cookie writes share the login/logout lock; read-only probes never write Cookies. */
export async function renewPersistentCookieSession() {
  const version = getAuthSessionVersion();
  if (!getCookieSessionInfo()?.persistent || renewedVersion === version && Date.now() - renewedAt < 24 * 60 * 60 * 1000)
    return;
  await withAuthLock(async () => {
    const info = getCookieSessionInfo();
    if (!isAuthSessionCurrent(version) || !info?.persistent || isAuthTransitionPending()) return;
    if (renewedVersion === version && Date.now() - renewedAt < 24 * 60 * 60 * 1000) return;
    const response = await fetch(`${getApiBase()}/auth/session/renew`, {
      method: "POST", credentials: "include", signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/json", "X-Changmen-Auth": "cookie", "X-CSRF-Token": info.csrfToken },
      body: JSON.stringify({ expectedBrowserSessionId: info.browserSessionId, expectedLoginEpoch: info.loginEpoch }),
    });
    const result = await response.json();
    if (!isAuthSessionCurrent(version)) return;
    if (!response.ok || result.ok !== true) throw new Error("登录凭证续期暂时不可用");
    renewedVersion = version;
    renewedAt = Date.now();
  });
}

async function runProbe(force: boolean) {
  if (!force && !isCookieAuthMode())
    return false;
  const version = getAuthSessionVersion();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${getApiBase()}/auth/session`, { credentials: "include", cache: "no-store", signal: controller.signal });
    if (!isAuthSessionCurrent(version))
      return false;
    // Cookie-only builds must not fall back to JWT against an old/misconfigured server.
    if (response.status === 404 && import.meta.env.VITE_WEB_COOKIE_AUTH === "1")
      throw new SessionRestoreConfigurationError("当前服务端不支持 Cookie 登录，请更新服务端后重试");
    if (response.status === 404 && !getCookieSessionInfo())
      return false;
    if (response.status === 401) {
      if (isAuthTransitionPending())
        return false;
      if (getCookieSessionInfo())
        invalidateAuthSession("SESSION_REVOKED");
      else if (isCookieAuthMode())
        clearAuthSession();
      return false;
    }
    if (!response.ok)
      throw new Error("登录服务暂时不可用");
    const info = await response.json() as CookieSessionInfo;
    if (!isAuthSessionCurrent(version))
      return false;
    if (!info.cookieEnabled) {
      if (import.meta.env.VITE_WEB_COOKIE_AUTH === "1")
        throw new SessionRestoreConfigurationError("登录服务配置已变更：服务端未启用 Cookie 登录，请检查配置");
      if (getCookieSessionInfo())
        throw new Error("登录服务配置已变更，请刷新页面");
      return false;
    }
    const apiOrigin = new URL(getApiBase() || window.location.origin, window.location.origin).origin;
    if (new URL(resolveChangmenWsBase(), window.location.origin).origin !== apiOrigin)
      throw new SessionRestoreConfigurationError("实时服务与登录服务的 Cookie 作用域不一致");
    if (!info.user?.id || !info.browserSessionId || !info.loginEpoch || !info.csrfToken)
      throw new Error("登录服务返回了无效会话");
    setCookieAuthMode(true);
    setCookieSessionInfo(info);
    const { stopJwtAutoRefresh } = await import("@/lib/jwtRefresh");
    if (isAuthSessionCurrent(version))
      stopJwtAutoRefresh();
    failures = 0;
    return true;
  }
  catch (err) {
    if (isAuthSessionCurrent(version)) {
      browserAuthState.value = "unavailable";
      if (err instanceof SessionRestoreConfigurationError)
        stopWebSessionWatch();
    }
    throw err;
  }
  finally { clearTimeout(timeout); }
}

// A new login never shares the previous login's probe.
export function probeCookieSession(_compat = true, force = false): Promise<boolean> {
  const version = getAuthSessionVersion();
  if (pending?.version === version)
    return pending.task;
  const task = runProbe(force);
  const current = { version, task };
  pending = current;
  void task.finally(() => { if (pending === current) pending = null; }).catch(() => {});
  return task;
}
async function onWake() {
  if (!watching)
    return;
  if (timer) clearTimeout(timer);
  const generation = watchGeneration;
  try {
    await probeCookieSession();
    if (generation !== watchGeneration) return;
    await renewPersistentCookieSession();
    if (generation !== watchGeneration) return;
    failures = 0;
  }
  catch (err) {
    if (generation !== watchGeneration) return;
    if (err instanceof SessionRestoreConfigurationError) {
      if (generation === watchGeneration) stopWebSessionWatch();
      return;
    }
    failures += 1;
  }
  if (generation !== watchGeneration) return;
  if (watching) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void onWake(); }, failures ? Math.min(60_000, 2000 * 2 ** Math.min(failures - 1, 5)) : 60_000);
  }
}
let watchGeneration = 0;
export function startWebSessionWatch() {
  if (watching)
    return;
  watching = true;
  watchGeneration += 1;
  failures = 0;
  timer = setTimeout(() => { void onWake(); }, 2000);
  window.addEventListener("focus", onWake);
  window.addEventListener("online", onWake);
  window.addEventListener("pageshow", onWake);
}
export function stopWebSessionWatch() {
  watching = false;
  watchGeneration += 1;
  if (timer) clearTimeout(timer);
  timer = null;
  window.removeEventListener("focus", onWake);
  window.removeEventListener("online", onWake);
  window.removeEventListener("pageshow", onWake);
}
