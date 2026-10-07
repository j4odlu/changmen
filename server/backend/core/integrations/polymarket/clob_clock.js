// [changmen 扩展] 每个 CLOB origin 独立校时；提交时只读取校时结果。
const clocks = new Map();
const flights = new Map();
const MAX_AGE_MS = Math.max(10_000, Number(process.env.PM_CLOCK_MAX_AGE_MS) || 300_000);
const MAX_RTT_MS = Math.max(100, Number(process.env.PM_CLOCK_MAX_RTT_MS) || 2_000);
const samples = [];
export function getClobClockSamples() { return samples.slice(); }

export function clobTimestamp(url) {
  const state = clocks.get(new URL(url).origin);
  const now = performance.now();
  if (!state || now - state.mono > MAX_AGE_MS
    || Math.abs(Date.now() - state.wall - (now - state.mono)) > 1_000)
    throw new Error("PM 提交校时未就绪，请重新预检");
  return Math.floor((state.serverMs + now - state.mono) / 1_000);
}

export function clobClockInfo(url) {
  clobTimestamp(url);
  const state = clocks.get(new URL(url).origin);
  return { source: "clob_time", sampleAgeMs: performance.now() - state.mono };
}

export async function prepareClobClock(url) {
  const origin = new URL(url).origin;
  try {
    clobTimestamp(origin);
    const lease = MAX_AGE_MS - (performance.now() - clocks.get(origin).mono) - 1_000;
    if (lease >= 10_000) return Math.min(120_000, lease);
  } catch { /* 冷启动或失效 */ }
  await refreshClobClock(origin);
  return Math.min(120_000, MAX_AGE_MS - 1_000);
}

async function refreshClobClock(origin) {
  if (flights.has(origin)) return flights.get(origin);
  const task = (async () => {
    const start = performance.now();
    let success = false;
    try {
      const res = await fetch(`${origin}/time`, { signal: AbortSignal.timeout(MAX_RTT_MS) });
      const seconds = Number(String(await res.text()).trim());
      const end = performance.now();
      if (!res.ok || !Number.isFinite(seconds) || seconds <= 0 || end - start > MAX_RTT_MS)
        throw new Error("PM 服务端校时失败");
      const old = clocks.get(origin);
      if (old?.timer) clearTimeout(old.timer);
      clocks.set(origin, { mono: end, wall: Date.now(), serverMs: seconds * 1_000 + (end - start) / 2, timer: null });
      success = true;
    } finally {
      samples.push({ origin, at: Date.now(), ms: performance.now() - start, success });
      if (samples.length > 100) samples.shift();
      // 失败不延长旧样本寿命，但必须保留后台恢复能力。
      const state = clocks.get(origin);
      if (state) {
        clearTimeout(state.timer);
        state.timer = setTimeout(() => { void refreshClobClock(origin).catch(() => {}); }, 60_000);
        state.timer.unref?.();
      }
    }
  })();
  flights.set(origin, task);
  try { await task; } finally { if (flights.get(origin) === task) flights.delete(origin); }
}

export function clearClobClocksForTests() {
  for (const state of clocks.values()) clearTimeout(state.timer);
  clocks.clear(); flights.clear();
  samples.length = 0;
}
