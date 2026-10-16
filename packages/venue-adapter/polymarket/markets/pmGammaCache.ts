/** [changmen 扩展] 仅 Gamma 公共查询共享短缓存；CLOB 接单状态不经过这里。 */
export const PM_GAMMA_CACHE_MS = 2_000;
const MAX_ENTRIES = 256;

/** [changmen 扩展] 本地查询证据，不把 HTTP 接收时间冒充上游数据时间。 */
export interface PmGammaEvidence {
  source: "network" | "inflight" | "cache";
  requestedAt: number;
  receivedAt: number;
  requestMs: number;
  startedTick: number;
}
const evidence = new WeakMap<object, PmGammaEvidence>();
export function getPmGammaEvidence(value: object | null | undefined) {
  const entry = value ? evidence.get(value) : undefined;
  if (!entry) return null;
  const ageMs = Math.max(Date.now() - entry.requestedAt, performance.now() - entry.startedTick);
  return { ...entry, ageMs, fresh: Date.now() >= entry.requestedAt
    && performance.now() >= entry.startedTick && ageMs < PM_GAMMA_CACHE_MS };
}

function copyWithEvidence<T extends object>(value: T, entry: PmGammaEvidence): T {
  const copy = structuredClone(value);
  evidence.set(copy, { ...entry });
  return copy;
}

export function createPmGammaReader<T extends object>(load: (id: string) => Promise<T | null>) {
  const values = new Map<string, { value: T; startedAt: number; startedTick: number; evidence: PmGammaEvidence }>();
  const flights = new Map<string, Promise<T | null>>();
  const timings = new WeakMap<Promise<T | null>, PmGammaEvidence>();
  const read = async (id: string): Promise<T | null> => {
    const cached = values.get(id);
    const age = cached ? Date.now() - cached.startedAt : Infinity;
    const elapsed = cached ? performance.now() - cached.startedTick : Infinity;
    if (cached && age >= 0 && age < PM_GAMMA_CACHE_MS && elapsed >= 0 && elapsed < PM_GAMMA_CACHE_MS)
      return copyWithEvidence(cached.value, { ...cached.evidence, source: "cache" });
    values.delete(id);
    let task = flights.get(id);
    const source = task ? "inflight" : "network";
    if (!task) {
      const startedAt = Date.now();
      const startedTick = performance.now();
      task = load(id);
      const timing: PmGammaEvidence = { source: "network", requestedAt: startedAt,
        startedTick, receivedAt: 0, requestMs: 0 };
      timings.set(task, timing);
      flights.set(id, task);
      const current = task;
      // 从请求开始计龄，慢响应不能再获得额外的 2 秒有效期。
      void task.then(value => {
        timing.receivedAt = Date.now();
        timing.requestMs = Math.max(0, performance.now() - startedTick);
        const age = Date.now() - startedAt;
        // [changmen 扩展] 单调时钟限制真实存活时间，校时回拨不能延长短缓存。
        const elapsed = performance.now() - startedTick;
        if (flights.get(id) === current && value && Object.keys(value).length && age >= 0 && age < PM_GAMMA_CACHE_MS && elapsed >= 0 && elapsed < PM_GAMMA_CACHE_MS) {
          values.set(id, { value: structuredClone(value), startedAt, startedTick, evidence: { ...timing } });
          while (values.size > MAX_ENTRIES)
            values.delete(values.keys().next().value!);
        }
      }).finally(() => {
        if (flights.get(id) === current) flights.delete(id);
      }).catch(() => {});
    }
    const value = await task;
    return value ? copyWithEvidence(value, { ...timings.get(task)!, source }) : null;
  };
  return { read, clear: () => { values.clear(); flights.clear(); } };
}
