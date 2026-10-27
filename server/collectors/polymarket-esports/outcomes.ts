/// <reference path="./legacy-modules.d.ts" />
/** [changmen 扩展] 官方赛果独立于 discovery 生命周期；不写 platform_* 或报价。 */
import type { PolymarketMarketIndex, PolymarketMarketIndexEntry, PolymarketOutcomeEntry } from "@changmen/api-contract";
import { readPolymarketMarketIndex, writePolymarketMarketIndex } from "@changmen/storage/polymarket_market_index";
import { fetchPolymarketOfficialMarkets } from "./api.ts";
import { resolvePolymarketMapMarketOutcome } from "./parse.ts";

const DAY = 24 * 3600_000;
const hasWinner = (entry: PolymarketMarketIndexEntry) => entry.outcomeKind === "official"
  && (entry.mapOutcome === "home" || entry.mapOutcome === "away");

/** 已确认保留 30 天；未确认补查 7 天。已知官方胜方不被暂时缺值覆盖。 */
export function mergePolymarketOutcomeEntries(
  previous: PolymarketOutcomeEntry[], entries: PolymarketMarketIndexEntry[], now = Date.now(),
): PolymarketOutcomeEntry[] {
  const byId = new Map(previous.map(entry => [entry.marketId, entry]));
  for (const entry of entries) {
    if (!entry.marketId || !entry.homeTokenId || !entry.awayTokenId)
      continue;
    const prev = byId.get(entry.marketId);
    const sameTokens = prev?.homeTokenId === entry.homeTokenId && prev?.awayTokenId === entry.awayTokenId;
    const base = sameTokens ? prev : undefined;
    const { homeClobPrice: _home, awayClobPrice: _away, ...metadata } = entry;
    byId.set(entry.marketId, {
      ...base, ...metadata, firstSeenAt: base?.firstSeenAt ?? now,
      homeOdds: 0, awayOdds: 0, status: "Locked",
      ...(base && hasWinner(base) && !hasWinner(entry)
        ? { mapOutcome: base.mapOutcome, outcomeKind: base.outcomeKind } : {}),
    });
  }
  return [...byId.values()].filter(entry => {
    const anchor = Number(entry.startTime) > 0 ? Number(entry.startTime) : entry.firstSeenAt;
    return now - anchor <= (hasWinner(entry) ? 30 : 7) * DAY;
  });
}

export async function refreshPolymarketOutcomes(deps: {
  readIndex?: () => PolymarketMarketIndex | null;
  writeIndex?: (index: PolymarketMarketIndex) => void;
  fetchOfficial?: typeof fetchPolymarketOfficialMarkets;
  nowMs?: number;
} = {}): Promise<{ queried: number; resolved: number }> {
  const readIndex = deps.readIndex ?? readPolymarketMarketIndex;
  const writeIndex = deps.writeIndex ?? writePolymarketMarketIndex;
  const index = readIndex();
  if (!index)
    return { queried: 0, resolved: 0 };
  const now = deps.nowMs ?? Date.now();
  const outcomes = mergePolymarketOutcomeEntries(index.outcomeEntries ?? [], index.entries, now);
  const due = outcomes.filter(entry => !hasWinner(entry)
    && Number(entry.nextCheckAt ?? 0) <= now && Number(entry.startTime ?? 0) <= now)
    .sort((a, b) => Number(a.lastCheckedAt ?? 0) - Number(b.lastCheckedAt ?? 0)).slice(0, 48);
  const fetched = await (deps.fetchOfficial ?? fetchPolymarketOfficialMarkets)(due.map(entry => ({
    conditionId: entry.marketId, clobTokenIds: [entry.homeTokenId, entry.awayTokenId],
  })));
  const byId = new Map(fetched.map(market => [String(market.conditionId ?? ""), market]));
  let resolved = 0;
  for (const entry of due) {
    const market = byId.get(entry.marketId);
    const outcome = market ? resolvePolymarketMapMarketOutcome(market) : null;
    if (outcome) {
      Object.assign(entry, outcome);
      resolved++;
    }
    entry.lastCheckedAt = now;
    // 新近结束优先；长期未结算降频。重启后沿用持久化的重试时间。
    const age = now - (Number(entry.startTime) || entry.firstSeenAt);
    entry.nextCheckAt = now + (age < 6 * 3600_000 ? 60_000 : age < DAY ? 5 * 60_000 : 15 * 60_000);
  }
  writeIndex({ ...index, updatedAt: Math.max(now, index.updatedAt + 1), outcomeEntries: outcomes });
  return { queried: due.length, resolved };
}
