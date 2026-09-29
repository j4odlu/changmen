/** Cookie 写入及旧 refresh token 轮换在同源标签页之间串行，避免互相覆盖。 */
export function withAuthLock<T>(run: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks)
    return navigator.locks.request("changmen:session-refresh", run);
  return run();
}
