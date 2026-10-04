import type { LoginInfo, UserInfo } from "@/types/esport";
import { advanceAuthSessionVersion, beginAuthTransition, browserAuthState, clearAuthSession, getAuthSessionVersion, getCookieSessionInfo, isAuthSessionCurrent, usesWebCookieSession, post, setCookieSessionInfo, setCookieAuthMode, setRefreshToken, setToken, unwrap } from "@/api/client";
import { withAuthLock } from "@/lib/authLock";
import { getApiBase } from "@/config/apiBase";

type WebLoginInfo = Omit<LoginInfo, "token"> & { token?: string };

function markCookieLoginUncertain() {
  setCookieAuthMode(true);
  setCookieSessionInfo(null);
  setToken(null);
  setRefreshToken(null);
  advanceAuthSessionVersion();
  browserAuthState.value = "unavailable";
}

async function cookieLogin(userName: string, password: string) {
  try {
    const response = await fetch(`${getApiBase()}/auth/login`, {
      method: "POST", credentials: "include", signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/json", "X-Changmen-Auth": "cookie" },
      body: JSON.stringify({ userName, password }),
    });
    return await response.json();
  }
  catch {
    // A lost response can follow a committed login. Recover by reading the Cookie;
    // never replay this write or keep credentials from the previous login epoch.
    markCookieLoginUncertain();
    throw new Error("登录结果尚未确认，请刷新页面确认会话");
  }
}

export async function login(userName: string, password: string) {
  return withAuthLock(async () => {
    const finishTransition = beginAuthTransition();
    try {
      const nativeCookie = import.meta.env.VITE_WEB_COOKIE_AUTH === "1";
      const data = nativeCookie ? await cookieLogin(userName, password) : await post<LoginInfo>("Client_Login", { userName, password });
      if (nativeCookie && data.code === "LOGIN_RESULT_UNCERTAIN") {
        markCookieLoginUncertain();
        throw new Error(data.msg || "登录已提交，请刷新页面确认");
      }
      const info = unwrap(data) as WebLoginInfo;
      if (!info || (!nativeCookie && !info.token))
        throw new Error(data.msg || "登录失败");
      if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") window.dispatchEvent(new Event("changmen:auth-ending"));
      setCookieAuthMode(info.sessionMode === "cookie");
      setCookieSessionInfo(null);
      setToken(info.token || null);
      setRefreshToken(info.sessionMode === "cookie" ? null : info.refreshToken || null);
      advanceAuthSessionVersion();
      if (nativeCookie) {
        const { probeCookieSession } = await import("@/lib/webSession");
        if (!await probeCookieSession(true, true))
          throw new Error("登录已提交，但会话尚未确认，请刷新页面");
      }
      return info;
    }
    finally {
      finishTransition();
    }
  });
}

export async function logout() {
  let version = getAuthSessionVersion();
  return withAuthLock(async () => {
    if (!isAuthSessionCurrent(version))
      return false;
    let session = getCookieSessionInfo();
    if (import.meta.env.VITE_WEB_COOKIE_AUTH === "1" && !session) {
      const { probeCookieSession } = await import("@/lib/webSession");
      await probeCookieSession(true, true);
      if (!isAuthSessionCurrent(version)) return false;
      session = getCookieSessionInfo();
      if (!session) { clearAuthSession(); return true; }
    }
    if (import.meta.env.VITE_WEB_COOKIE_AUTH === "1" && session) {
      const { stopWebSessionWatch } = await import("@/lib/webSession");
      if (!isAuthSessionCurrent(version)) return false;
      stopWebSessionWatch();
      advanceAuthSessionVersion();
      version = getAuthSessionVersion();
      // A failed request does not prove that the server revoked its HttpOnly Cookie.
      // Keep the identity for an explicit retry, while blocking new authenticated work.
      browserAuthState.value = "unavailable";
      if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") window.dispatchEvent(new Event("changmen:auth-ending"));
      try {
        const response = await fetch(`${getApiBase()}/auth/logout`, {
          method: "POST", credentials: "include", signal: AbortSignal.timeout(10_000),
          headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken },
          body: JSON.stringify({ expectedBrowserSessionId: session.browserSessionId, expectedLoginEpoch: session.loginEpoch }),
        });
        const result = await response.json();
        if (!(response.ok && result.ok === true) && !(response.status === 401 && result.code === "SESSION_REVOKED"))
          throw new Error("退出确认失败");
        if (!isAuthSessionCurrent(version)) return false;
        clearAuthSession();
        return true;
      } catch {
        if (!isAuthSessionCurrent(version)) return false;
        browserAuthState.value = "unavailable";
        throw new Error("退出尚未确认，当前页面已暂停登录操作；请重试退出，未确认前刷新可能恢复原会话");
      }
    }
    const request = usesWebCookieSession() && session ? fetch(`${getApiBase()}/auth/logout`, {
      method: "POST", credentials: "include", signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken },
      body: JSON.stringify({ expectedBrowserSessionId: session.browserSessionId, expectedLoginEpoch: session.loginEpoch }),
    }).then(async (response) => {
      if (!response.ok)
        throw new Error("退出确认失败，请稍后重试");
      await response.json();
    }) : post<null>("Client_Logout");
    // 请求已携带旧 token；立即使在途续期失效，防止退出后被慢响应重新登录。
    clearAuthSession();
    await request;
    return true;
  });
}

export async function getUserInfo() {
  return unwrap(await post<UserInfo>("Client_GetUserInfo"));
}

export async function getUserDetail() {
  return unwrap(await post<{ Id: number }>("Client_GetUserDetail"));
}
