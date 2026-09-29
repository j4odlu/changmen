import type { LoginInfo, UserInfo } from "@/types/esport";
import { advanceAuthSessionVersion, beginAuthTransition, clearAuthSession, getAuthSessionVersion, isAuthSessionCurrent, post, setCookieAuthMode, setRefreshToken, setToken, unwrap } from "@/api/client";
import { withAuthLock } from "@/lib/authLock";

export async function login(userName: string, password: string) {
  return withAuthLock(async () => {
    const finishTransition = beginAuthTransition();
    try {
      const data = await post<LoginInfo>("Client_Login", { userName, password });
      const info = unwrap(data);
      if (!info?.token)
        throw new Error(data.msg || "登录失败");
      setCookieAuthMode(info.sessionMode === "cookie");
      setToken(info.token);
      setRefreshToken(info.sessionMode === "cookie" ? null : info.refreshToken || null);
      advanceAuthSessionVersion();
      return info;
    }
    finally {
      finishTransition();
    }
  });
}

export async function logout() {
  const version = getAuthSessionVersion();
  return withAuthLock(async () => {
    if (!isAuthSessionCurrent(version))
      return;
    const request = post<null>("Client_Logout");
    // 请求已携带旧 token；立即使在途续期失效，防止退出后被慢响应重新登录。
    clearAuthSession();
    await request;
  });
}

export async function getUserInfo() {
  return unwrap(await post<UserInfo>("Client_GetUserInfo"));
}

export async function getUserDetail() {
  return unwrap(await post<{ Id: number }>("Client_GetUserDetail"));
}
