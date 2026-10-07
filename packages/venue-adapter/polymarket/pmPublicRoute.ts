// [changmen 扩展] 仅公开 GET 的 vps/official direct-first 路由使用。
interface Health { failures: number; until: number; backoff: number; probing: boolean }
const health = new Map<string, Health>();
const flights = new Map<string, Promise<unknown>>();
export function publicRouteKey(url: string): string {
  return `${new URL(url).origin}|browser-direct|vps-official`;
}
export async function withPublicRoute<T>(url: string, direct: () => Promise<T>, fallback: () => Promise<T>, networkError: (e: unknown) => boolean): Promise<T> {
  if (import.meta.env?.VITE_PM_PUBLIC_ROUTE_COOLDOWN === "0") {
    try { return await direct(); } catch (err) { if (!networkError(err)) throw err; return fallback(); }
  }
  const key = publicRouteKey(url);
  const state = health.get(key) ?? { failures: 0, until: 0, backoff: 30_000, probing: false };
  health.set(key, state);
  if (state.until > performance.now() || state.probing) return fallback();
  const probing = state.failures >= 2;
  if (probing) state.probing = true;
  try {
    const result = await direct();
    state.failures = 0; state.until = 0; state.backoff = 30_000;
    return result;
  } catch (err) {
    if (!networkError(err)) throw err;
    state.failures++;
    if (state.failures >= 2) {
      if (probing) state.backoff = Math.min(120_000, state.backoff * 2);
      state.until = performance.now() + state.backoff;
    }
    return fallback();
  } finally { state.probing = false; }
}
/** 在途合并，不缓存已完成响应；调用者获得独立副本。 */
export async function sharePublicGet<T>(key: string, request: () => Promise<T>): Promise<T> {
  let task = flights.get(key);
  if (!task) {
    task = request(); flights.set(key, task);
    void task.finally(() => { if (flights.get(key) === task) flights.delete(key); }).catch(() => {});
  }
  return structuredClone(await task) as T;
}
export function clearPmPublicRoutesForTests(): void { health.clear(); flights.clear(); }
