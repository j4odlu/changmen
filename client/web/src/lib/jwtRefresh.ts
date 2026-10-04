import {
  getAuthSessionVersion,
  isAuthSessionCurrent,
  isAuthTransitionPending,
  invalidateAuthSession,
  getRefreshToken,
  isCookieAuthMode,
  isSessionInvalidResponse,
  post,
  setRefreshToken,
  setCookieAuthMode,
  setToken,
} from "@/api/client";
import { withAuthLock } from "@/lib/authLock";
import { SessionRestoreConfigurationError } from "@/lib/sessionRestoreError";

let timer: ReturnType<typeof setInterval> | null = null;
let refreshInFlight: Promise<boolean> | null = null;
let refreshVersion = "";

const DEFAULT_RETRY_DELAYS_MS = [2_000, 5_000, 15_000] as const;

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runRefresh(retryDelaysMs: readonly number[]): Promise<boolean> {
  const version = getAuthSessionVersion();
  if (!getRefreshToken() && !isCookieAuthMode())
    return false;

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      if (!isAuthSessionCurrent(version))
        return false;
      const rt = getRefreshToken();
      const result = await post<{ token: string; refreshToken?: string; sessionMode?: "legacy" | "cookie" }>("Client_RefreshToken", {
        ...(rt ? { refreshToken: rt } : {}),
      });
      if (!isAuthSessionCurrent(version))
        return false;
      if (result.success !== 1) {
        if (["CSRF_INVALID", "ORIGIN_INVALID", "COOKIE_LOGIN_DISABLED"].includes(String(result.code || ""))) {
          throw new SessionRestoreConfigurationError(import.meta.env.DEV
            ? "登录服务配置不匹配，请检查开发地址、认证来源及 Cookie 登录配置后重试"
            : "登录请求校验失败，请刷新页面后重试");
        }
        if (isSessionInvalidResponse(result.code, result.msg)) {
          if (isAuthTransitionPending())
            return false;
          invalidateAuthSession(result.code);
          return false;
        }
        throw new Error(result.msg || "刷新 token 失败");
      }
      if (!result.info?.token)
        throw new Error("刷新 token 返回无效");
      const cookieMode = result.info.sessionMode === "cookie";
      if (cookieMode)
        setCookieAuthMode(true);
      setToken(result.info.token);
      if (cookieMode)
        setRefreshToken(null);
      else if (result.info.refreshToken)
        setRefreshToken(result.info.refreshToken);
      return true;
    }
    catch (err) {
      if (err instanceof SessionRestoreConfigurationError)
        throw err;
      if (!isAuthSessionCurrent(version))
        return false;
      if (!getRefreshToken() && !isCookieAuthMode())
        return false;
      if (attempt >= retryDelaysMs.length) {
        console.warn("[auth] token 刷新暂时失败，保留当前会话等待下轮重试:", err);
        return false;
      }
      await wait(retryDelaysMs[attempt]);
    }
  }
  return false;
}

export function refreshJwtSession(
  retryDelaysMs: readonly number[] = DEFAULT_RETRY_DELAYS_MS,
): Promise<boolean> {
  const version = getAuthSessionVersion();
  if (refreshInFlight && refreshVersion === version)
    return refreshInFlight;
  // Cookie 续期只读取共享 Cookie，不轮换/写入 Cookie，可并发，避免后台页持锁拖住前台页。
  // 旧 refresh token 的轮换必须跨标签页串行，锁内重新读最新凭证。
  const run = async () => isAuthSessionCurrent(version) ? runRefresh(retryDelaysMs) : false;
  const pending = isCookieAuthMode() ? run() : withAuthLock(run);
  const task = pending.catch((err) => {
    if (err instanceof SessionRestoreConfigurationError)
      throw err;
    console.warn("[auth] session refresh temporarily unavailable:", err);
    return false;
  });
  refreshVersion = version;
  refreshInFlight = task;
  void task.finally(() => {
    if (refreshInFlight === task)
      refreshInFlight = null;
  }).catch(() => {});
  return task;
}

/** 默认每 10 分钟刷新，给 15 分钟 access token 留出网络重试余量。 */
let lastWakeAt = 0;
function refreshInBackground() {
  void refreshJwtSession().catch((err) => {
    console.warn("[auth] 自动续期已停止:", err);
    stopJwtAutoRefresh();
  });
}
function refreshOnWake() {
  if (typeof document !== "undefined" && document.visibilityState === "hidden")
    return;
  if (Date.now() - lastWakeAt < 30_000)
    return;
  lastWakeAt = Date.now();
  refreshInBackground();
}

export function startJwtAutoRefresh(intervalMs = 10 * 60 * 1000) {
  stopJwtAutoRefresh();
  lastWakeAt = 0;
  timer = setInterval(() => {
    refreshInBackground();
  }, intervalMs);
  if (typeof window !== "undefined") {
    window.addEventListener("online", refreshOnWake);
    window.addEventListener("pageshow", refreshOnWake);
    window.addEventListener("focus", refreshOnWake);
  }
  if (typeof document !== "undefined")
    document.addEventListener("visibilitychange", refreshOnWake);
}

export function stopJwtAutoRefresh() {
  if (typeof window !== "undefined") {
    window.removeEventListener("online", refreshOnWake);
    window.removeEventListener("pageshow", refreshOnWake);
    window.removeEventListener("focus", refreshOnWake);
  }
  if (typeof document !== "undefined")
    document.removeEventListener("visibilitychange", refreshOnWake);
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
