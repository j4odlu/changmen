import type { CookieSessionInfo } from "@/lib/authSession";
import { browserAuthState, clearAuthSession, getAuthSessionVersion, getCookieSessionInfo, invalidateAuthSession, isAuthSessionCurrent, isAuthTransitionPending, isCookieAuthMode, setCookieAuthMode, setCookieSessionInfo } from "@/lib/authSession";
import { getApiBase } from "@/config/apiBase";
import { resolveChangmenWsBase } from "@changmen/venue-adapter/shared";

let pending: { version: string; task: Promise<boolean> } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let watching = false;
let failures = 0;

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
    // Only first contact with an old server may fall back to the JWT path.
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
      if (getCookieSessionInfo())
        throw new Error("登录服务配置已变更，请刷新页面");
      return false;
    }
    const apiOrigin = new URL(getApiBase() || window.location.origin, window.location.origin).origin;
    if (new URL(resolveChangmenWsBase(), window.location.origin).origin !== apiOrigin)
      throw new Error("实时服务与登录服务的 Cookie 作用域不一致");
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
    if (isAuthSessionCurrent(version))
      browserAuthState.value = "unavailable";
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
  try { await probeCookieSession(); failures = 0; }
  catch { failures += 1; }
  if (watching) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void onWake(); }, failures ? Math.min(60_000, 2000 * 2 ** Math.min(failures - 1, 5)) : 60_000);
  }
}
export function startWebSessionWatch() {
  if (watching)
    return;
  watching = true;
  failures = 0;
  timer = setTimeout(() => { void onWake(); }, 2000);
  window.addEventListener("focus", onWake);
  window.addEventListener("online", onWake);
  window.addEventListener("pageshow", onWake);
}
export function stopWebSessionWatch() {
  watching = false;
  if (timer) clearTimeout(timer);
  timer = null;
  window.removeEventListener("focus", onWake);
  window.removeEventListener("online", onWake);
  window.removeEventListener("pageshow", onWake);
}
