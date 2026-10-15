/** [changmen 扩展] 仅 Gamma 公共查询共享短缓存；CLOB 接单状态不经过这里。 */
export const PM_GAMMA_CACHE_MS = 2_000;
const MAX_ENTRIES = 256;

export function createPmGammaReader<T extends object>(load: (id: string) => Promise<T | null>) {
  const values = new Map<string, { value: T; startedAt: number; startedTick: number }>();
  const flights = new Map<string, Promise<T | null>>();
  const read = async (id: string): Promise<T | null> => {
    const cached = values.get(id);
    const age = cached ? Date.now() - cached.startedAt : Infinity;
    const elapsed = cached ? performance.now() - cached.startedTick : Infinity;
    if (cached && age >= 0 && age < PM_GAMMA_CACHE_MS && elapsed >= 0 && elapsed < PM_GAMMA_CACHE_MS)
      return structuredClone(cached.value);
    values.delete(id);
    let task = flights.get(id);
    if (!task) {
      const startedAt = Date.now();
      const startedTick = performance.now();
      task = load(id);
      flights.set(id, task);
      const current = task;
      // 从请求开始计龄，慢响应不能再获得额外的 2 秒有效期。
      void task.then(value => {
        const age = Date.now() - startedAt;
        // [changmen 扩展] 单调时钟限制真实存活时间，校时回拨不能延长短缓存。
        const elapsed = performance.now() - startedTick;
        if (flights.get(id) === current && value && Object.keys(value).length && age >= 0 && age < PM_GAMMA_CACHE_MS && elapsed >= 0 && elapsed < PM_GAMMA_CACHE_MS) {
          values.set(id, { value: structuredClone(value), startedAt, startedTick });
          while (values.size > MAX_ENTRIES)
            values.delete(values.keys().next().value!);
        }
      }).finally(() => {
        if (flights.get(id) === current) flights.delete(id);
      }).catch(() => {});
    }
    const value = await task;
    return value ? structuredClone(value) : null;
  };
  return { read, clear: () => { values.clear(); flights.clear(); } };
}
