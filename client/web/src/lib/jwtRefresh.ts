import {
  clearAuthSession,
  getRefreshToken,
  isSessionInvalidMessage,
  post,
  setRefreshToken,
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
  if (!rt)
    return false;

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      const result = await post<{ token: string; refreshToken?: string }>("Client_RefreshToken", {
        refreshToken: rt,
      });
      if (result.success !== 1) {
        if (isSessionInvalidMessage(result.msg)) {
          clearAuthSession();
          return false;
        }
        throw new Error(result.msg || "刷新 token 失败");
      }
      if (!result.info?.token)
        throw new Error("刷新 token 返回无效");
      setToken(result.info.token);
      if (result.info.refreshToken)
        setRefreshToken(result.info.refreshToken);
      return true;
    }
    catch (err) {
      if (!getRefreshToken())
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

/** 默认每 6 小时刷新（access token 通常 7 天） */
export function startJwtAutoRefresh(intervalMs = 6 * 60 * 60 * 1000) {
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
