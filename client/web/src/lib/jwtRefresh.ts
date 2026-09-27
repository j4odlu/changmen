import {
  clearAuthSession,
  getRefreshToken,
  isCookieAuthMode,
  isSessionInvalidResponse,
  post,
  setRefreshToken,
  setCookieAuthMode,
  setToken,
} from "@/api/client";

let timer: ReturnType<typeof setInterval> | null = null;
let refreshInFlight: Promise<boolean> | null = null;

const DEFAULT_RETRY_DELAYS_MS = [2_000, 5_000, 15_000] as const;

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runRefresh(retryDelaysMs: readonly number[]): Promise<boolean> {
  const rt = getRefreshToken();
  if (!rt && !isCookieAuthMode())
    return false;

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      const result = await post<{ token: string; refreshToken?: string; sessionMode?: "legacy" | "cookie" }>("Client_RefreshToken", {
        ...(rt ? { refreshToken: rt } : {}),
      });
      if (result.success !== 1) {
        if (isSessionInvalidResponse(result.code, result.msg)) {
          clearAuthSession();
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
  if (refreshInFlight)
    return refreshInFlight;
  const task = runRefresh(retryDelaysMs);
  refreshInFlight = task;
  void task.finally(() => {
    if (refreshInFlight === task)
      refreshInFlight = null;
  });
  return task;
}

/** 默认每 10 分钟刷新，给 15 分钟 access token 留出网络重试余量。 */
export function startJwtAutoRefresh(intervalMs = 10 * 60 * 1000) {
  stopJwtAutoRefresh();
  timer = setInterval(() => {
    void refreshJwtSession();
  }, intervalMs);
}

export function stopJwtAutoRefresh() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
