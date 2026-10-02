import type { ApiEnvelope } from "@changmen/api-contract";
import { buildEsportUrl } from "@changmen/api-contract/urls";
import { ElMessage } from "element-plus";
import { shallowRef } from "vue";
import { armEsportPostDelaySample, finalizeEsportPostDelaySample } from "@/api/apiDelay";
import { getApiBase } from "@/config/apiBase";
import { a8Axios, responseBodyText } from "@changmen/client-core/shared/a8Axios";

const FORM_HEADERS = { "Content-Type": "application/x-www-form-urlencoded;" };
const TOKEN_COOKIE = "app_token";
const AUTH_MODE_KEY = "app:auth-mode";
const SESSION_VERSION_KEY = "app:session-version";
const AUTH_TRANSITION_KEY = "app:auth-transition";

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

const authToken = shallowRef<string | null>(!cookieAuthMode && typeof localStorage !== "undefined"
  ? localStorage.getItem("app:token")
  : null);
if (!authToken.value && !cookieAuthMode)
  authToken.value = readTokenCookie();
if (authToken.value)
  syncTokenCookie(authToken.value);

let refreshToken: string | null = !cookieAuthMode && typeof localStorage !== "undefined"
  ? localStorage.getItem("app:refresh-token")
  : null;

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
  if (isCookieAuthMode())
    return null;
  if (typeof localStorage !== "undefined")
    refreshToken = localStorage.getItem("app:refresh-token");
  return refreshToken;
}

export function setRefreshToken(token: string | null) {
  refreshToken = token;
  if (typeof localStorage !== "undefined") {
    if (token && !cookieAuthMode)
      localStorage.setItem("app:refresh-token", token);
    else localStorage.removeItem("app:refresh-token");
  }
}

export function getToken(): string | null {
  return authToken.value;
}

export function setToken(token: string | null) {
  authToken.value = token;
  if (typeof localStorage !== "undefined") {
    if (token && !cookieAuthMode)
      localStorage.setItem("app:token", token);
    else localStorage.removeItem("app:token");
  }
  syncTokenCookie(cookieAuthMode ? null : token);
}

export function authHeaders(): Record<string, string> {
  return authToken.value ? { token: authToken.value } : {};
}

const SESSION_KICK_MSGS = new Set([
  "请先登录",
  "未登录",
  "账号已在其他设备登录",
  "会话已失效，请重新登录",
]);
const SESSION_INVALID_CODES = new Set([
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

export interface PostOptions {
  /** 对齐 A8 `_r.post` 的 `errorTip:false`：失败时不抛错（由调用方读 success） */
  errorTip?: boolean;
  /** 对齐 A8 `_r.post(..., { successTip })`：成功时提示服务端 msg */
  successTip?: boolean;
}

function toA8PostBody(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    out[key] = value && typeof value === "object" ? JSON.stringify(value) : value;
  }
  return out;
}

async function executePost<T>(
  action: string,
  body: Record<string, unknown>,
  query = "",
  opts?: PostOptions,
  retriedAfterRefresh = false,
): Promise<ApiEnvelope<T>> {
  const started = Date.now();
  const sessionVersion = getAuthSessionVersion();
  const sentToken = getToken();
  const authAction = ["Client_Login", "Client_RefreshToken", "Client_Logout"].includes(action);
  armEsportPostDelaySample(started);
  try {
    if (!authAction && !isAuthSessionCurrent(sessionVersion))
      throw new Error("登录状态已变更，请刷新页面");
    const res = await a8Axios.post<ApiEnvelope<T>>(
      buildEsportUrl(action, query, getApiBase()),
      toA8PostBody(body),
      { headers: { ...FORM_HEADERS, ...authHeaders() }, withCredentials: true },
    );
    const json = res.data;

    if (!authAction && !isAuthSessionCurrent(sessionVersion))
      throw new Error("登录状态已变更，请重试");
    if (!authAction && json.success === 0 && isSessionInvalidResponse(json.code, json.msg) && isAuthTransitionPending())
      throw new Error("登录状态正在更新，请稍后重试");
    const code = json.success === 0 ? String(json.code || "").toUpperCase() : "";
    const recoverable = code === "ACCESS_TOKEN_EXPIRED" || code === "AUTH_REQUIRED";
    let preserveExpiredSession = false;
    if (
      json.success === 0
      && recoverable
      && !authAction
      && !retriedAfterRefresh
      && hasAuthSession()
    ) {
      const { refreshJwtSession } = await import("@/lib/jwtRefresh");
      const refreshed = sentToken !== getToken() && Boolean(getToken()) || await refreshJwtSession([]);
      if (!isAuthSessionCurrent(sessionVersion))
        throw new Error("登录状态已变更，请重试");
      if (refreshed)
        return executePost<T>(action, body, query, opts, true);
      preserveExpiredSession = Boolean(getRefreshToken() || isCookieAuthMode());
    }

    // 续期成功后仍被普通接口拒绝，不反向判定长期会话失效。
    // 只重放明确在业务执行前被拒绝的请求一次；网络失败/业务失败绝不重放。
    if (recoverable && retriedAfterRefresh && hasAuthSession())
      preserveExpiredSession = true;

    if (
      json.success === 0
      && isSessionInvalidResponse(json.code, json.msg)
      && !authAction
      && !preserveExpiredSession
    ) {
      invalidateAuthSession(json.code);
    }
    if (opts?.successTip && json.success === 1) {
      ElMessage.success(json.msg || "操作成功");
    }
    return json;
  }
  catch (err) {
    const data = (err as { response?: { data?: unknown } }).response?.data;
    const hint = responseBodyText(data).slice(0, 160);
    throw new Error(
      hint
        ? `后端未连接或未就绪，请先运行 backend.bat 或 dev.bat（VPS 请等 pm2 重启后再试）: ${hint}`
        : err instanceof Error ? err.message : String(err),
    );
  }
  finally {
    finalizeEsportPostDelaySample(started);
  }
}

export async function post<T>(
  action: string,
  body: Record<string, unknown> = {},
  query = "",
  opts?: PostOptions,
): Promise<ApiEnvelope<T>> {
  return executePost<T>(
    action,
    body,
    query,
    opts,
  );
}

/** [A8 可证实] `_r.post`：application/x-www-form-urlencoded */
export async function postForm<T>(
  action: string,
  fields: Record<string, string>,
  query = "",
  opts?: PostOptions,
): Promise<ApiEnvelope<T>> {
  return executePost<T>(
    action,
    fields,
    query,
    opts,
  );
}

export function unwrap<T>(data: ApiEnvelope<T>): T {
  if (data.success !== 1)
    throw new Error(data.msg || "请求失败");
  return data.info as T;
}
