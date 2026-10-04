import type { ApiEnvelope } from "@changmen/api-contract";
import { buildEsportUrl } from "@changmen/api-contract/urls";
import { ElMessage } from "element-plus";
import { browserAuthState, usesWebCookieSession } from "@/lib/authSessionState";
import { armEsportPostDelaySample, finalizeEsportPostDelaySample } from "@/api/apiDelay";
import { getApiBase } from "@/config/apiBase";
import { a8Axios, responseBodyText } from "@changmen/client-core/shared/a8Axios";

import { authHeaders, getAuthSessionVersion, getRefreshToken, getToken, hasAuthSession, invalidateAuthSession, isAuthSessionCurrent, isAuthTransitionPending, isCookieAuthMode, isSessionInvalidResponse } from "@/lib/authSession";
export * from "@/lib/authSession";

const FORM_HEADERS = { "Content-Type": "application/x-www-form-urlencoded;" };

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
    if (!authAction && isCookieAuthMode() && browserAuthState.value === "unavailable")
      throw new Error("登录服务暂时不可用，请稍后重试");
    const res = await a8Axios.post<ApiEnvelope<T>>(
      buildEsportUrl(action, query, getApiBase()),
      toA8PostBody(body),
      { headers: { ...FORM_HEADERS, ...(action === "Client_RefreshToken" ? {} : authHeaders()) }, withCredentials: true },
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
      && !usesWebCookieSession()
      && import.meta.env.VITE_WEB_COOKIE_AUTH !== "1"
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
