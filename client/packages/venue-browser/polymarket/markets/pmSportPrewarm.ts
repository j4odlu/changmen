import type { BetOption } from "@changmen/client-core/models/betOption";
import { fetchGammaEventById, fetchGammaMarketByTokenId } from "./pmSportGamma";
import { getPolymarketPmSportBlockReasonFromOption } from "./pmSportGuard";

let active = 0;
let windowAt = 0;
let starts = 0;
const recent = new Map<string, number>();
/** [changmen 扩展] 仅预热已选中的套利候选；最多两组并发、每两秒四组，不排队也不阻塞预检。 */
export function prewarmPmSportForCandidate(option: BetOption): void {
  if (option.type !== "Polymarket" || !option.itemId || getPolymarketPmSportBlockReasonFromOption(option)) return;
  const now = performance.now();
  if (now - windowAt >= 2_000 || now < windowAt) { windowAt = now; starts = 0; }
  const eventId = String(option.match?.providers?.Polymarket ?? "").trim();
  const key = JSON.stringify([option.itemId, eventId]);
  const last = recent.get(key);
  if (active >= 2 || starts >= 4 || (last != null && now >= last && now - last < 2_000)) return;
  recent.delete(key); recent.set(key, now);
  while (recent.size > 128) recent.delete(recent.keys().next().value!);
  active++; starts++;
  void Promise.allSettled([
    fetchGammaMarketByTokenId(option.itemId),
    eventId ? fetchGammaEventById(eventId) : Promise.resolve(null),
  ]).finally(() => { active--; });
}
