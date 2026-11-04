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
  const rawFields = version === "v2" ? [market.positionIds, market.position_ids] : [market.clobTokenIds, market.clob_token_ids];
  const fields = rawFields.filter(value => value != null);
  const parsed = fields.map(raw => parseAssetIds(raw, version));
  if (!parsed.length || parsed.some(ids => !ids.length || ids.length !== parsed[0].length
    || ids.some((id, index) => id !== parsed[0][index]))) return [];
  return parsed[0];
}

/** 当前 Gamma 线协议：版本必填；只接受官方 camelCase 字段及其规定格式。历史快照不得进入此入口。 */
export function polymarketGammaMarketAssetIds(market) {
  if (market?.version !== "v1" && market?.version !== "v2") return [];
  const field = market.version === "v2" ? "positionIds" : "clobTokenIds";
  if (market.version === "v1" && typeof market[field] !== "string") return [];
  return polymarketMarketAssetIds({ version: market.version, [field]: market[field] });
}

function parseAssetIds(raw, version) {
  if (typeof raw === "string") {
    if (version === "v2") return []; // 官方 V2 positionIds 是数组，不是 JSON 文本。
    try { raw = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(raw) || !raw.length) return [];
  const ids = raw.map(value => typeof value === "string" ? value.trim() : version ? "" : typeof value === "number" && Number.isSafeInteger(value) ? String(value) : "");
  if (ids.some(id => !id || (version && !/^\d+$/.test(id))) || new Set(ids).size !== ids.length) return [];
  return ids;
}

const sameAssetSet = (left, right) => left.length > 0 && left.length === right.length && left.every(id => right.includes(id));

/** 兼容缺版本的旧快照，但已给出的身份字段不能跳过校验。 */
export function polymarketMarketHasAssetMetadata(market) {
  return Boolean(market && [market.version, market.positionIds, market.position_ids, market.clobTokenIds, market.clob_token_ids].some(value => value != null));
}

/** 缺少成交资产时，只能用完整且唯一的标签→ID 对照恢复，不能压缩空项或选择首个同名项。 */
export function polymarketMarketAssetForOutcome(market, outcome) {
  const label = typeof outcome === "string" ? outcome.trim() : "";
  const ids = polymarketMarketAssetIds(market);
  const labels = jsonArray(market?.outcomes);
  if (!label || !ids.length || labels.length !== ids.length || labels.some(value => typeof value !== "string" || !value.trim())) return "";
  const normalized = labels.map(value => value.trim());
  if (new Set(normalized).size !== normalized.length) return "";
  return ids[normalized.indexOf(label)] ?? "";
}

/** 缺省值不猜身份；两个来源明确给出的 condition 必须相同（十六进制大小写不敏感）。 */
export function polymarketConditionsAgree(...values) {
  const ids = values.filter(value => value != null && String(value).trim()).map(value => String(value).trim().toLowerCase());
  return ids.every(id => id === ids[0]);
}

/** CLOB 使用 tokens；若同时携带 Gamma 字段，必须与同协议 token 集合一致。 */
export function polymarketClobMarketAssetIds(market, fallbackVersion) {
  if (!market || !Array.isArray(market.tokens)) return [];
  const version = market.version ?? fallbackVersion;
  if (version != null && version !== "v1" && version !== "v2") return [];
  if (version == null && (market.positionIds != null || market.position_ids != null)) return [];
  const ids = parseAssetIds(market.tokens.map(token => token?.token_id), version);
  const explicit = version === "v2" ? market.positionIds != null || market.position_ids != null
    : market.clobTokenIds != null || market.clob_token_ids != null;
  if (explicit && !sameAssetSet(ids, polymarketMarketAssetIds({ ...market, version }))) return [];
  return ids;
}

/** 只接受唯一的官方赢家；多赢家不能降级为价格判定。 */
export function polymarketOfficialWinner(market) {
  const winners = Array.isArray(market?.tokens) ? market.tokens.filter(token => token?.winner === true) : [];
  const assetId = winners.length === 1 ? String(winners[0]?.token_id ?? "").trim() : "";
  return { assetId: assetId && polymarketMarketHasAsset(market, assetId) ? assetId : null, ambiguous: winners.length > 1 };
}

function jsonArray(raw) {
  if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { return []; } }
  return Array.isArray(raw) ? raw : [];
}

/**
 * [changmen 扩展] 前后端共用的 CLOB 结果合并：先核对身份，保留 Gamma ID/标签顺序。
 * 冲突不能通过重写资产字段“修复”；无 Gamma 时才按可信 CLOB token 集合建立快照。
 */
export function mergePolymarketClobMarket(clob, base, expectedConditionId) {
  const unchanged = base ?? null;
  if (!polymarketConditionsAgree(expectedConditionId, base?.condition_id, base?.conditionId, clob?.condition_id, clob?.conditionId)) return unchanged;
  if (base?.version != null && clob?.version != null && base.version !== clob.version) return unchanged;
  const version = base?.version ?? clob?.version;
  const clobIds = polymarketClobMarketAssetIds(clob, version);
  if (!clobIds.length) return unchanged;
  const hasBaseIdentity = polymarketMarketHasAssetMetadata(base);
  const baseIds = polymarketMarketAssetIds(base);
  if (hasBaseIdentity && !sameAssetSet(baseIds, clobIds)) return unchanged;
  const ids = baseIds.length ? baseIds : clobIds;
  const tokens = ids.map(id => clob.tokens.find(token => String(token?.token_id ?? "").trim() === id));
  const identity = { version, ...polymarketMarketAssetFields({ version }, ids), tokens };
  const { assetId: winner } = polymarketOfficialWinner(identity);
  const basePrices = base?.outcomePrices ?? base?.outcome_prices;
  if (!winner && basePrices != null && !baseIds.length) return unchanged;
  // 没有 ID 映射的 Gamma 价格/标签不能借用 CLOB 的排列顺序。
  const oldPrices = baseIds.length ? basePrices : undefined;
  const labels = baseIds.length ? jsonArray(base?.outcomes) : [];
  return {
    ...(base ?? {}), ...identity,
    condition_id: expectedConditionId ?? base?.condition_id ?? base?.conditionId ?? clob?.condition_id ?? clob?.conditionId,
    question: base?.question ?? clob?.question,
    title: base?.title ?? base?.question ?? clob?.question,
    slug: base?.slug ?? clob?.market_slug,
    closed: base?.closed === true || clob?.closed === true || Boolean(winner),
    outcomes: JSON.stringify(labels.length === ids.length ? labels : tokens.map(token => String(token?.outcome ?? ""))),
    outcomePrices: winner ? JSON.stringify(ids.map(id => id === winner ? "1" : "0"))
      : oldPrices ?? JSON.stringify(tokens.map(token => String(token?.price ?? 0))),
    umaResolutionStatus: winner ? base?.umaResolutionStatus ?? base?.uma_resolution_status ?? "settled_normal"
      : base?.umaResolutionStatus ?? base?.uma_resolution_status,
  };
}

/** 结算只能比较同一市场/协议的资产。无版本、无 Gamma 元数据的旧 CLOB 快照兼容 tokens。 */
export function polymarketMarketHasAsset(market, assetId) {
  const id = typeof assetId === "string" ? assetId.trim() : "";
  if (!market || !id) return false;
  if (polymarketMarketHasAssetMetadata(market)) {
    return polymarketMarketAssetIds(market).includes(id);
  }
  const ids = Array.isArray(market.tokens)
    ? polymarketMarketAssetIds({ clobTokenIds: market.tokens.map(token => token?.token_id) }) : [];
  return ids.includes(id);
}

/** CLOB 结果补入 Gamma 时，价格顺序与对应协议的 ID 字段一起更新。 */
export function polymarketMarketAssetFields(market, ids) {
  return market?.version === "v2"
    ? { positionIds: [...ids], position_ids: [...ids] }
    : { clobTokenIds: JSON.stringify(ids), clob_token_ids: JSON.stringify(ids) };
}
