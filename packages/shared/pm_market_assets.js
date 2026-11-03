/** [changmen 扩展] Gamma 市场版本决定交易资产；不根据两组字段的存在顺序猜协议。
 * https://docs.polymarket.com/market-data/market-details#market-outcomes
 */
export function polymarketMarketAssetIds(market) {
  if (!market || typeof market !== "object") return [];
  const version = market.version;
  const positions = market.positionIds ?? market.position_ids;
  if (version != null && version !== "v1" && version !== "v2") return [];
  // 旧 CTF / 本地历史快照没有 version；带 V2 字段却缺版本时不能回退到 CTF。
  if (version == null && positions != null) return [];
  let raw = version === "v2" ? positions : market.clobTokenIds ?? market.clob_token_ids;
  if (typeof raw === "string") {
    if (version === "v2") return []; // 官方 V2 positionIds 是数组，不是 JSON 文本。
    try { raw = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(raw) || !raw.length) return [];
  const ids = raw.map(value => typeof value === "string" ? value.trim() : version ? "" : typeof value === "number" && Number.isSafeInteger(value) ? String(value) : "");
  if (ids.some(id => !id || (version && !/^\d+$/.test(id))) || new Set(ids).size !== ids.length) return [];
  return ids;
}

/** CLOB 结果补入 Gamma 时，价格顺序与对应协议的 ID 字段一起更新。 */
export function polymarketMarketAssetFields(market, ids) {
  return market?.version === "v2"
    ? { positionIds: [...ids], position_ids: [...ids] }
    : { clobTokenIds: JSON.stringify(ids), clob_token_ids: JSON.stringify(ids) };
}
