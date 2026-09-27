import type { ApiEnvelope } from "@changmen/api-contract";
import { buildEsportUrl } from "@changmen/api-contract/urls";
import { ElMessage } from "element-plus";
import { armEsportPostDelaySample, finalizeEsportPostDelaySample } from "@/api/apiDelay";
import { getApiBase } from "@/config/apiBase";
import { a8Axios, responseBodyText } from "@changmen/client-core/shared/a8Axios";

const FORM_HEADERS = { "Content-Type": "application/x-www-form-urlencoded;" };
const TOKEN_COOKIE = "app_token";
const AUTH_MODE_KEY = "app:auth-mode";
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

let authToken: string | null = !cookieAuthMode && typeof localStorage !== "undefined"
  ? localStorage.getItem("app:token")
  : null;
if (!authToken && !cookieAuthMode)
  authToken = readTokenCookie();
if (authToken)
  syncTokenCookie(authToken);

let refreshToken: string | null = !cookieAuthMode && typeof localStorage !== "undefined"
  ? localStorage.getItem("app:refresh-token")
  : null;

export function isCookieAuthMode(): boolean { return cookieAuthMode; }

export function hasAuthSession(): boolean { return Boolean(authToken || refreshToken || cookieAuthMode); }

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

export function getRefreshToken(): string | null { return refreshToken; }

export function setRefreshToken(token: string | null) {
  refreshToken = token;
  if (typeof localStorage !== "undefined") {
    if (token && !cookieAuthMode)
      localStorage.setItem("app:refresh-token", token);
    else localStorage.removeItem("app:refresh-token");
  }
}

export function getToken(): string | null {
  return authToken;
}

export function setToken(token: string | null) {
  authToken = token;
  if (typeof localStorage !== "undefined") {
    if (token && !cookieAuthMode)
      localStorage.setItem("app:token", token);
    else localStorage.removeItem("app:token");
  }
  syncTokenCookie(cookieAuthMode ? null : token);
}

export function authHeaders(): Record<string, string> {
  return authToken ? { token: authToken } : {};
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
  return SESSION_INVALID_CODES.has(normalizedCode) || isSessionInvalidMessage(message);
}

export function clearAuthSession() {
  setToken(null);
  setRefreshToken(null);
  setCookieAuthMode(false);
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
  armEsportPostDelaySample(started);
  try {
    const res = await a8Axios.post<ApiEnvelope<T>>(
      buildEsportUrl(action, query, getApiBase()),
      toA8PostBody(body),
      { headers: { ...FORM_HEADERS, ...authHeaders() }, withCredentials: true },
    );
    const json = res.data;

    // 浏览器从后台/休眠恢复时，15 分钟 access token 可能先于定时器过期。
    // 只透明续期并重放一次；refresh 本身绝不递归，临时网络故障也不清长期会话。
    let preserveExpiredSession = false;
    if (
      json.success === 0
      && String(json.code || "").toUpperCase() === "ACCESS_TOKEN_EXPIRED"
      && action !== "Client_RefreshToken"
      && !retriedAfterRefresh
      && hasAuthSession()
    ) {
      const { refreshJwtSession } = await import("@/lib/jwtRefresh");
      if (await refreshJwtSession([]))
        return executePost<T>(action, body, query, opts, true);
      preserveExpiredSession = hasAuthSession();
    }

    if (
      json.success === 0
      && isSessionInvalidResponse(json.code, json.msg)
      && action !== "Client_Login"
      && !preserveExpiredSession
    ) {
      clearAuthSession();
      window.location.href = "/";
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
