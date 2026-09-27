import type { LoginInfo, UserInfo } from "@/types/esport";
import { clearAuthSession, post, setCookieAuthMode, setRefreshToken, setToken, unwrap } from "@/api/client";

export async function login(userName: string, password: string) {
  const data = await post<LoginInfo>("Client_Login", { userName, password });
  const info = unwrap(data);
  if (!info?.token)
    throw new Error(data.msg || "登录失败");
  setCookieAuthMode(info.sessionMode === "cookie");
  setToken(info.token);
  if (info.sessionMode === "cookie")
    setRefreshToken(null);
  else if (info.refreshToken)
    setRefreshToken(info.refreshToken);
  return info;
}

export async function logout() {
  try {
    await post<null>("Client_Logout");
  }
  finally {
    clearAuthSession();
  }
}

export async function getUserInfo() {
  return unwrap(await post<UserInfo>("Client_GetUserInfo"));
}

export async function getUserDetail() {
  return unwrap(await post<{ Id: number }>("Client_GetUserDetail"));
}
