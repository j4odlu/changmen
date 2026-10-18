/**
 * GetCollectPlatform 下发用：磁盘全量 MarketIndex ∩ 当前 client_matches.Matchs[provider]。
 * 不写盘；合场变时靠 updatedAt（base + sid 整数指纹）让浏览器跳出 lastIndexUpdatedAt 短路。
 */

/**
 * @param {unknown} matches
 * @param {string} provider
 * @returns {Set<string>}
 */
export function collectMatchedSourceIds(matches, provider) {
  const out = new Set();
  if (!Array.isArray(matches) || !provider)
    return out;
  for (const row of matches) {
    const sid = row?.Matchs?.[provider] ?? row?.matchs?.[provider];
    if (sid == null || sid === "")
      continue;
    out.add(String(sid));
  }
  return out;
}

/**
 * @param {unknown} matches
 * @returns {number}
 */
export function maxClientMatchBuiltAt(matches) {
  if (!Array.isArray(matches) || !matches.length)
    return 0;
  let max = 0;
  for (const row of matches) {
    const t = Number(row?.built_at ?? row?.builtAt ?? 0);
    if (Number.isFinite(t) && t > max)
      max = t;
  }
  return max;
}

/**
 * 稳定指纹：同 sid 集 → 同值；空集也非 0（避免与「未过滤的纯 disk updatedAt」整数相等）。
 * @param {Iterable<string>} ids
 * @returns {number} 1..999999
 */
export function matchedIdSetStamp(ids) {
  let h = 2166136261;
  const sorted = [...ids].map(String).sort();
  for (const id of sorted) {
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= 0xff;
  }
  return ((h >>> 0) % 999999) + 1;
}

/**
 * @param {number} diskUpdatedAt
 * @param {unknown} matches
 * @param {Set<string>} matchedIds
 * @returns {number}
 */
export function resolveFilteredIndexUpdatedAt(diskUpdatedAt, matches, matchedIds) {
  const base = Math.max(Number(diskUpdatedAt) || 0, maxClientMatchBuiltAt(matches));
  const stamp = matchedIdSetStamp(matchedIds ?? []);
  // 必须用整数混入：epoch ms 量级下 stamp/1e6 会被 float ulp 吃掉，导致指纹失效、部署后卡在全量 Index
  return base + stamp;
}

/**
 * @param {string} provider
 * @param {import("@changmen/api-contract").PolymarketMarketIndex | import("@changmen/api-contract").PredictFunMarketIndex | import("@changmen/api-contract").SxBetMarketIndex | null | undefined} index
 * @param {unknown} matches client_matches 行数组；空/缺省 = 无匹配 → 空 Index
 * @returns {import("@changmen/api-contract").PolymarketMarketIndex | import("@changmen/api-contract").PredictFunMarketIndex | import("@changmen/api-contract").SxBetMarketIndex | null}
 */
export function filterMarketIndexByClientMatches(provider, index, matches = []) {
  if (!index || typeof index !== "object")
    return index ?? null;

  const matchedIds = collectMatchedSourceIds(matches, provider);
  const updatedAt = resolveFilteredIndexUpdatedAt(index.updatedAt, matches, matchedIds);
  const entriesIn = Array.isArray(index.entries) ? index.entries : [];

  const entries = entriesIn.filter((entry) => {
    const sid = String(entry?.sourceMatchId || "").trim();
    if (sid && matchedIds.has(sid))
      return true;
    const slug = String(entry?.eventSlug || "").trim();
    if (slug && matchedIds.has(slug))
      return true;
    return false;
  });

  if (provider === "Polymarket") {
    const assetIdSet = new Set();
    for (const row of entries) {
      if (row.homeTokenId)
        assetIdSet.add(String(row.homeTokenId));
      if (row.awayTokenId)
        assetIdSet.add(String(row.awayTokenId));
    }
    return {
      updatedAt,
      assetIds: [...assetIdSet],
      entries,
      // [changmen 扩展] 赛果按相同合场范围下发，但不加入行情 assetIds。
      ...(Array.isArray(index.outcomeEntries) ? {
        outcomeEntries: index.outcomeEntries.filter(entry =>
          matchedIds.has(String(entry?.sourceMatchId || "").trim())
          || matchedIds.has(String(entry?.eventSlug || "").trim())),
      } : {}),
    };
  }

  if (provider === "PredictFun") {
    const marketIdSet = new Set();
    for (const row of entries) {
      if (row.homeMarketId)
        marketIdSet.add(String(row.homeMarketId));
      if (row.awayMarketId)
        marketIdSet.add(String(row.awayMarketId));
      if (row.marketId)
        marketIdSet.add(String(row.marketId));
    }
    return {
      updatedAt,
      marketIds: [...marketIdSet],
      entries,
    };
  }

  if (provider === "SXBet") {
    const marketHashSet = new Set();
    for (const row of entries) {
      if (row.marketHash)
        marketHashSet.add(String(row.marketHash));
    }
    return {
      updatedAt,
      marketHashes: [...marketHashSet],
      entries,
    };
  }

  return index;
}
