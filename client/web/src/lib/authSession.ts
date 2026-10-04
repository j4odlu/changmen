import { shallowRef } from "vue";
import { browserAuthState, getCookieSessionInfo, setCookieSessionInfo, usesWebCookieSession } from "@/lib/authSessionState";

const TOKEN_COOKIE = "app_token";
const AUTH_MODE_KEY = "app:auth-mode";
const SESSION_VERSION_KEY = "app:session-version";
const AUTH_TRANSITION_KEY = "app:auth-transition";
export { browserAuthState, getCookieSessionInfo, setCookieSessionInfo, usesWebCookieSession } from "@/lib/authSessionState";
export type { CookieSessionInfo } from "@/lib/authSessionState";
export function isWebAuthenticated() { return Boolean(getToken() || getCookieSessionInfo()); }

/** 新登录提交期间，旧会话的撤销响应不能中断它；超时防止崩溃标签页留下永久门控。 */
export function beginAuthTransition(): () => void {
  const value = `${Date.now() + 60_000}:${Math.random()}`;
  localStorage.setItem(AUTH_TRANSITION_KEY, value);
  return () => {
    if (localStorage.getItem(AUTH_TRANSITION_KEY) === value)
      localStorage.removeItem(AUTH_TRANSITION_KEY);
  };
}

export function isAuthTransitionPending(): boolean {
  return Number(localStorage.getItem(AUTH_TRANSITION_KEY)?.split(":")[0] || 0) > Date.now();
}
export function getAuthSessionVersion(): string {
  return typeof localStorage === "undefined" ? "" : localStorage.getItem(SESSION_VERSION_KEY) || "";
}
let localSessionVersion = getAuthSessionVersion();

export function isAuthSessionCurrent(version: string): boolean {
  return version === localSessionVersion && version === getAuthSessionVersion();
}

/** 登录/退出边界跨标签页共享；续期不更换版本。 */
export function advanceAuthSessionVersion() {
  localSessionVersion = `${Date.now()}:${Math.random()}`;
  if (typeof localStorage !== "undefined")
    localStorage.setItem(SESSION_VERSION_KEY, localSessionVersion);
}
let cookieAuthMode
  = typeof localStorage !== "undefined" && localStorage.getItem(AUTH_MODE_KEY) === "cookie";
// [changmen 扩展] Native Cookie builds never load or persist old application JWTs.
const nativeCookieOnly = () => import.meta.env.VITE_WEB_COOKIE_AUTH === "1";

function readTokenCookie(): string | null {
  if (typeof document === "undefined")
    return null;
  const m = document.cookie.match(/(?:^|; )app_token=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function syncTokenCookie(token: string | null) {
  if (typeof document === "undefined")
    return;
  if (token) {
    document.cookie = `${TOKEN_COOKIE}=${encodeURIComponent(token)}; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax`;
  }
  else {
    document.cookie = `${TOKEN_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  }
}

const authToken = shallowRef<string | null>(!nativeCookieOnly() && !cookieAuthMode && typeof localStorage !== "undefined"
  ? localStorage.getItem("app:token")
  : null);
if (!nativeCookieOnly() && !authToken.value && !cookieAuthMode)
  authToken.value = readTokenCookie();
if (authToken.value)
  syncTokenCookie(authToken.value);

let refreshToken: string | null = !nativeCookieOnly() && !cookieAuthMode && typeof localStorage !== "undefined"
  ? localStorage.getItem("app:refresh-token")
  : null;
if (nativeCookieOnly()) {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem("app:token");
    localStorage.removeItem("app:refresh-token");
  }
  syncTokenCookie(null);
}

export function isCookieAuthMode(): boolean {
  if (typeof localStorage !== "undefined")
    cookieAuthMode = localStorage.getItem(AUTH_MODE_KEY) === "cookie";
  return cookieAuthMode;
}

export function hasAuthSession(): boolean { return Boolean(authToken.value || refreshToken || cookieAuthMode); }

export function setCookieAuthMode(enabled: boolean) {
  cookieAuthMode = enabled;
  if (typeof localStorage !== "undefined") {
    if (enabled)
      localStorage.setItem(AUTH_MODE_KEY, "cookie");
    else localStorage.removeItem(AUTH_MODE_KEY);
    if (enabled) {
      localStorage.removeItem("app:token");
      localStorage.removeItem("app:refresh-token");
    }
  }
  if (enabled)
    syncTokenCookie(null);
}

export function getRefreshToken(): string | null {
  if (nativeCookieOnly() || isCookieAuthMode())
    return null;
  if (typeof localStorage !== "undefined")
    refreshToken = localStorage.getItem("app:refresh-token");
  return refreshToken;
}

export function setRefreshToken(token: string | null) {
  if (nativeCookieOnly()) token = null;
  refreshToken = token;
  if (typeof localStorage !== "undefined") {
    if (token && !cookieAuthMode)
      localStorage.setItem("app:refresh-token", token);
    else localStorage.removeItem("app:refresh-token");
  }
}

export function getToken(): string | null {
  return nativeCookieOnly() ? null : authToken.value;
}

export function setToken(token: string | null) {
  if (nativeCookieOnly()) token = null;
  authToken.value = token;
  if (token)
    browserAuthState.value = "authenticated";
  if (typeof localStorage !== "undefined") {
    if (token && !cookieAuthMode)
      localStorage.setItem("app:token", token);
    else localStorage.removeItem("app:token");
  }
  syncTokenCookie(cookieAuthMode ? null : token);
}

export function authHeaders(): Record<string, string> {
  if (usesWebCookieSession()) {
    return { "X-Changmen-Auth": "cookie", "X-CSRF-Token": getCookieSessionInfo()!.csrfToken };
  }
  if (nativeCookieOnly()) return { "X-Changmen-Auth": "cookie" };
  return authToken.value ? { token: authToken.value } : {};
}

const SESSION_KICK_MSGS = new Set([
  "请先登录",
  "未登录",
  "账号已在其他设备登录",
  "会话已失效，请重新登录",
]);
const SESSION_INVALID_CODES = new Set([
  "JWT_DISABLED",
  "COOKIE_LOGIN_REQUIRED",
  "AUTH_REQUIRED",
  "ACCESS_TOKEN_EXPIRED",
  "REFRESH_TOKEN_EXPIRED",
  "SESSION_REVOKED",
  "ACCOUNT_DISABLED",
]);

export function isSessionInvalidMessage(message: unknown): boolean {
  return SESSION_KICK_MSGS.has(String(message || "").trim());
}

export function isSessionInvalidResponse(code: unknown, message: unknown): boolean {
  const normalizedCode = String(code || "").trim().toUpperCase();
  // 有结构化 code 时以 code 为准，临时错误的文案不可触发清会话。
  return normalizedCode ? SESSION_INVALID_CODES.has(normalizedCode) : isSessionInvalidMessage(message);
}

export function clearAuthSession() {
  // [changmen 扩展] Revoke the PM work session while old credentials are still available.
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") window.dispatchEvent(new Event("changmen:auth-ending"));
  setCookieSessionInfo(null);
  browserAuthState.value = "anonymous";
  setToken(null);
  setRefreshToken(null);
  setCookieAuthMode(false);
  advanceAuthSessionVersion();
}

export function invalidateAuthSession(code: unknown) {
  console.warn("[auth] session ended:", String(code || "AUTH_REQUIRED"));
  clearAuthSession();
  if (typeof window !== "undefined")
    window.location.href = "/";
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    // 别的标签页明确登录/退出时重建用户状态，避免旧账号数据继续运行。
    if (event.key === SESSION_VERSION_KEY && event.oldValue !== event.newValue)
      window.location.reload();
  });
}
