/// <reference path="./legacy-modules.d.ts" />
import type { PolymarketMarketIndex, PolymarketMarketIndexEntry } from "@changmen/api-contract";
import type { IndexCandidate, IndexOptions, PlatformMatch, PlatformBet } from "./types.ts";
import { mergePolymarketOutcomeEntries } from "./outcomes.ts";
import {
  readPolymarketMarketIndex,
  writePolymarketMarketIndex,
} from "@changmen/storage/polymarket_market_index.js";

/** @param {import("@changmen/api-contract").PolymarketMarketIndexEntry[]} entries */
export function buildPolymarketMarketIndexFromEntries(entries: PolymarketMarketIndexEntry[]): PolymarketMarketIndex {
  const assetIdSet = new Set<string>();
  for (const row of entries) {
    if (row.homeTokenId)
      assetIdSet.add(String(row.homeTokenId));
    if (row.awayTokenId)
      assetIdSet.add(String(row.awayTokenId));
  }
  return {
    updatedAt: Date.now(),
    assetIds: [...assetIdSet],
    entries,
    outcomeEntries: mergePolymarketOutcomeEntries(readPolymarketMarketIndex()?.outcomeEntries ?? [], entries),
  };
}

/**
 * Index 与 DB 同生命周期：本轮 candidates 覆盖同 sid；其余保留；只剔 removeSourceMatchIds（ended）。
 * 禁止无脑写空数组清空（空窗仍保留未 ended 场次）。
 * @param {import("@changmen/api-contract").PolymarketMarketIndexEntry[]} freshEntries
 * @param {{
 *   removeSourceMatchIds?: string[],
 *   previousEntries?: import("@changmen/api-contract").PolymarketMarketIndexEntry[],
 * }} [opts]
 */
export function mergePolymarketIndexLifecycle(freshEntries: PolymarketMarketIndexEntry[], opts: IndexOptions = {}): PolymarketMarketIndexEntry[] {
  const removeIds = new Set(
    (opts.removeSourceMatchIds || []).map(String).filter(Boolean),
  );
  const fresh = (freshEntries || []).filter(
    e => !removeIds.has(String(e?.sourceMatchId || "")),
  );
  const freshSids = new Set(
    fresh.map(e => String(e.sourceMatchId || "")).filter(Boolean),
  );
  const previous = opts.previousEntries
    ?? readPolymarketMarketIndex()?.entries
    ?? [];
  const kept = [];
  for (const prev of previous) {
    const sid = String(prev?.sourceMatchId || "");
    if (!sid || removeIds.has(sid) || freshSids.has(sid))
      continue;
    kept.push(prev);
  }
  return [...fresh, ...kept];
}

/**
 * 把上一轮 index 中需软保留的场次条目并回本轮。
 * retainSourceMatchIds 与本轮 candidates 无交集（由调用方保证），故按 sid 全量并回所有 map 条目。
 * 旧条目缺 startTime 时补戳（now-60s），避免「无 startTime → 每轮都保」无限残留。
 * @param {import("@changmen/api-contract").PolymarketMarketIndexEntry[]} entries
 * @param {{
 *   retainSourceMatchIds?: string[],
 *   previousEntries?: import("@changmen/api-contract").PolymarketMarketIndexEntry[],
 *   nowMs?: number,
 * }} [opts]
 */
export function mergeRetainedPolymarketIndexEntries(entries: PolymarketMarketIndexEntry[], opts: IndexOptions = {}): PolymarketMarketIndexEntry[] {
  const retainIds = new Set(
    (opts.retainSourceMatchIds || []).map(String).filter(Boolean),
  );
  if (!retainIds.size)
    return entries;

  const nowMs = Number(opts.nowMs) || Date.now();
  // 本轮已有的 marketId（防御：若 retain 与 candidates 意外重叠，不重复插入）
  const haveMarketIds = new Set(
    entries.map(e => String(e.marketId || e.sourceBetId || "")).filter(Boolean),
  );
  const out = [...entries];
  for (const prev of opts.previousEntries || []) {
    const sid = String(prev?.sourceMatchId || "");
    if (!sid || !retainIds.has(sid))
      continue;
    const mid = String(prev.marketId || prev.sourceBetId || "");
    if (mid && haveMarketIds.has(mid))
      continue;
    const startTime = Number(prev.startTime) > 0
      ? Number(prev.startTime)
      : nowMs - 60_000;
    out.push({ ...prev, startTime });
    if (mid)
      haveMarketIds.add(mid);
  }
  return out;
}

/**
 * 从上一轮 Index 推出仍应软保留的 sourceMatchId（按开赛窗，不依赖 DB 是否已被孤儿删）。
 * @param {import("@changmen/api-contract").PolymarketMarketIndexEntry[]|null|undefined} previousEntries
 * @param {Set<string>|string[]} currentSourceMatchIds
 * @param {number} nowMs
 * @param {number} pastMs
 * @param {number} futureMs
 * @returns {string[]}
 */
export function resolveRetainIdsFromPreviousIndex(
  previousEntries: PolymarketMarketIndexEntry[] | null | undefined,
  currentSourceMatchIds: Set<string> | string[],
  nowMs: number,
  pastMs: number,
  futureMs: number,
): string[] {
  const current = currentSourceMatchIds instanceof Set
    ? currentSourceMatchIds
    : new Set((currentSourceMatchIds || []).map(String).filter(Boolean));
  const minStart = nowMs - pastMs;
  const maxStart = nowMs + futureMs;
  const retain = new Set<string>();
  for (const prev of previousEntries || []) {
    const sid = String(prev?.sourceMatchId || "").trim();
    if (!sid || current.has(sid) || retain.has(sid))
      continue;
    const start = Number(prev?.startTime) || 0;
    // 无 startTime：部署过渡期仍保留；merge 时会补戳，之后按窗过期
    if (!start || (start >= minStart && start <= maxStart))
      retain.add(sid);
  }
  return [...retain];
}

/**
 * 把保留场次的旧 Index 条目还原成 writePlatformMatches / replaceBets 可用结构。
 * @param {import("@changmen/api-contract").PolymarketMarketIndexEntry[]} previousEntries
 * @param {string[]} retainSourceMatchIds
 * @returns {{ matches: object[], betsByMatch: Map<string, object[]> }}
 */
export function rebuildPlatformRowsFromIndexEntries(previousEntries: PolymarketMarketIndexEntry[], retainSourceMatchIds: string[]): { matches: PlatformMatch[]; betsByMatch: Map<string, PlatformBet[]> } {
  const retain = new Set((retainSourceMatchIds || []).map(String).filter(Boolean));
  /** @type {Map<string, object>} */
  const matchBySid = new Map<string, PlatformMatch>();
  /** @type {Map<string, object[]>} */
  const betsByMatch = new Map<string, PlatformBet[]>();

  for (const entry of previousEntries || []) {
    const sid = String(entry?.sourceMatchId || "").trim();
    if (!sid || !retain.has(sid))
      continue;
    if (!matchBySid.has(sid)) {
      const homeName = String(entry.homeName || "");
      const awayName = String(entry.awayName || "");
      matchBySid.set(sid, {
        Type: "Polymarket",
        SourceMatchID: sid,
        SourceGameID: "",
        StartTime: Number(entry.startTime) || Date.now(),
        HomeID: "",
        Home: homeName,
        AwayID: "",
        Away: awayName,
        Teams: [
          { Type: "Polymarket", TeamID: "", Name: homeName, GameID: "", Logo: "" },
          { Type: "Polymarket", TeamID: "", Name: awayName, GameID: "", Logo: "" },
        ],
      });
      betsByMatch.set(sid, []);
    }
    betsByMatch.get(sid)!.push({
      Type: "Polymarket",
      SourceMatchID: sid,
      SourceBetID: String(entry.sourceBetId || entry.marketId || ""),
      Map: Number(entry.map ?? 0),
      BetName: Number(entry.map) > 0 ? `[地图${entry.map}] 获胜者` : "[全场] 获胜者",
      SourceHomeID: String(entry.homeTokenId || ""),
      HomeName: String(entry.homeName || ""),
      HomeOdds: Number(entry.homeOdds) || 0,
      SourceAwayID: String(entry.awayTokenId || ""),
      AwayName: String(entry.awayName || ""),
      AwayOdds: Number(entry.awayOdds) || 0,
      Status: String(entry.status || "Locked"),
    });
  }

  return {
    matches: [...matchBySid.values()],
    betsByMatch,
  };
}

/**
 * @param {Array<{
 *   marketId: string,
 *   assetIds: [string, string],
 *   match: { SourceMatchID: string, StartTime?: number },
 *   bet: Record<string, unknown>,
 * }>} candidates
 * @param {Record<string, number>} [buyPrices]
 * @param {{
 *   retainSourceMatchIds?: string[],
 *   previousEntries?: import("@changmen/api-contract").PolymarketMarketIndexEntry[],
 *   nowMs?: number,
 *   removeSourceMatchIds?: string[],
 * }} [opts]
 */
export function persistPolymarketMarketIndex(candidates: IndexCandidate[], buyPrices: Record<string, number> = {}, opts: IndexOptions = {}): void {
  const entries = candidates.map((mapped): PolymarketMarketIndexEntry => {
    const homeTokenId = String(mapped.assetIds[0] ?? "");
    const awayTokenId = String(mapped.assetIds[1] ?? "");
    const homeClob = Number(buyPrices[homeTokenId]);
    const awayClob = Number(buyPrices[awayTokenId]);
    const mapOutcome = mapped.mapOutcome === "home" || mapped.mapOutcome === "away"
      ? mapped.mapOutcome
      : undefined;
    const outcomeKind = mapped.outcomeKind === "official" || mapped.outcomeKind === "price"
      ? mapped.outcomeKind
      : undefined;
    const resolutionSource = mapped.resolutionSource != null && String(mapped.resolutionSource).trim()
      ? String(mapped.resolutionSource).trim()
      : undefined;
    const eventSlug = mapped.eventSlug != null && String(mapped.eventSlug).trim()
      ? String(mapped.eventSlug).trim()
      : undefined;
    const startTime = Number(mapped.match?.StartTime) || 0;
    return {
      sourceMatchId: String(mapped.match.SourceMatchID),
      marketId: String(mapped.marketId),
      homeTokenId,
      awayTokenId,
      sourceBetId: String(mapped.bet.SourceBetID ?? mapped.marketId),
      map: Number(mapped.bet.Map ?? 0),
      homeName: String(mapped.bet.HomeName ?? ""),
      awayName: String(mapped.bet.AwayName ?? ""),
      homeOdds: Number(mapped.bet.HomeOdds) || 0,
      awayOdds: Number(mapped.bet.AwayOdds) || 0,
      status: String(mapped.bet.Status ?? "Locked"),
      ...(startTime > 0 ? { startTime } : {}),
      ...(Number.isFinite(homeClob) && homeClob > 0 && homeClob < 1
        ? { homeClobPrice: homeClob }
        : {}),
      ...(Number.isFinite(awayClob) && awayClob > 0 && awayClob < 1
        ? { awayClobPrice: awayClob }
        : {}),
      ...(mapOutcome ? { mapOutcome, outcomeKind: outcomeKind || "price" } : {}),
      ...(resolutionSource ? { resolutionSource } : {}),
      ...(eventSlug ? { eventSlug } : {}),
    };
  });
  // 旧 soft-retain（按窗）仅在显式传 retainSourceMatchIds 时启用；默认走 lifecycle merge
  const softMerged = mergeRetainedPolymarketIndexEntries(entries, opts);
  const merged = mergePolymarketIndexLifecycle(softMerged, {
    removeSourceMatchIds: opts.removeSourceMatchIds,
    previousEntries: opts.previousEntries,
  });
  writePolymarketMarketIndex(buildPolymarketMarketIndexFromEntries(merged));
}
