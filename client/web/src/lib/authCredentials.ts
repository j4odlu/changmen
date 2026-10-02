import { authHeaders, browserAuthState, getAuthSessionVersion, getToken, isAuthSessionCurrent, usesWebCookieSession } from "@/api/client";
import { getApiBase } from "@/config/apiBase";
import { refreshJwtSession } from "@/lib/jwtRefresh";

/** Compatibility credential for external relays and SDKs that only support Bearer JWT. */
export function createCompatibilityTokenProvider(): () => Promise<string> {
  const version = getAuthSessionVersion();
  return async () => {
    if (!isAuthSessionCurrent(version))
      throw new Error("登录状态已变更，请重新开始操作");
    const token = await getCompatibilityToken();
    if (!isAuthSessionCurrent(version))
      throw new Error("登录状态已变更，请重新开始操作");
    return token;
  };
}

export async function getCompatibilityToken(): Promise<string> {
  const version = getAuthSessionVersion();
  if (browserAuthState.value === "unavailable")
    throw new Error("登录服务暂时不可用");
  const token = getToken();
  let expiresAt = 0;
  try { expiresAt = Number(JSON.parse(atob(token!.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))).exp) * 1000; }
  catch { /* The server validates malformed legacy credentials. */ }
  if (!token || expiresAt && expiresAt <= Date.now() + 30_000) {
    if (!await refreshJwtSession([]))
      throw new Error("登录凭证暂时无法恢复");
  }
  if (!isAuthSessionCurrent(version))
    throw new Error("登录状态已变更，请重试");
  const current = getToken();
  if (!current)
    throw new Error("请先登录");
  return current;
}

export async function getRequestAuthHeaders(url: string): Promise<Record<string, string>> {
  const origin = window.location.origin;
  const localBackend = new URL(url, origin).origin === new URL(getApiBase() || origin, origin).origin;
  if (localBackend && usesWebCookieSession()) {
    if (browserAuthState.value === "unavailable")
      throw new Error("登录服务暂时不可用");
    return authHeaders();
  }
  return { token: await getCompatibilityToken() };
}
