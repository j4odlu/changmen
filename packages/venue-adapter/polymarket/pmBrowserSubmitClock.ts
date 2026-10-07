import { directGet } from "@changmen/client-core/shared/http";
import { POLYMARKET_CLOB_API } from "./api";

const MAX_AGE_MS = 120_000;
const MAX_RTT_MS = 2_000;
const samples = new Map<string, { at: number; serverMs: number }>();
const flights = new Map<string, Promise<void>>();
function origin(gateway?: string): string {
  return new URL(gateway || POLYMARKET_CLOB_API).origin;
}

/** [changmen 扩展] 预检校准本机 L2 时间；提交只读缓存，不发 /time。 */
export function browserSubmitClockReady(gateway?: string): boolean {
  const sample = samples.get(origin(gateway));
  const age = sample ? performance.now() - sample.at : -1;
  return age >= 0 && age < MAX_AGE_MS;
}

export function browserSubmitTimestamp(gateway?: string): number {
  if (!browserSubmitClockReady(gateway)) throw Object.assign(new Error("PM 本地提交校时未就绪，请重新预检"), { pmSubmitNotSent: true });
  const sample = samples.get(origin(gateway))!;
  return Math.floor((sample.serverMs + performance.now() - sample.at) / 1_000);
}

export async function prepareBrowserSubmitClock(gateway?: string): Promise<void> {
  if (browserSubmitClockReady(gateway)) return;
  const key = origin(gateway);
  const existing = flights.get(key);
  if (existing) return existing;
  const task = (async () => {
    const start = performance.now();
    const raw = await directGet<unknown>(`${key}/time`, {}, { timeout: MAX_RTT_MS });
    const end = performance.now();
    const rtt = end - start;
    const seconds = typeof raw === "number" || typeof raw === "string" ? Number(raw) : NaN;
    if (!Number.isSafeInteger(seconds) || seconds <= 0 || rtt < 0 || rtt > MAX_RTT_MS)
      throw new Error("PM 本地提交校时未就绪：时间采样失败，请重新预检");
    samples.set(key, { at: end, serverMs: seconds * 1_000 + rtt / 2 });
  })();
  flights.set(key, task);
  try { await task; }
  finally { if (flights.get(key) === task) flights.delete(key); }
}

export function clearBrowserSubmitClockForTests(): void {
  samples.clear();
  flights.clear();
}
