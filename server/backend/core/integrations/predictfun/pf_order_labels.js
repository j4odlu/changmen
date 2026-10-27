/**
 * PredictFun 订单 Match/Bet/Item 文案（对齐 PM 可读侧栏，勿裸 marketId/tokenId）
 */

import { readPredictFunMarketIndex } from "@changmen/storage/predictfun_market_index";

function trimStr(v) {
  return String(v ?? "").trim();
}

/** 「市场 844582」/ 纯数字 / PredictFun 占位 → 仍须升级 */
export function isBarePfMatchLabel(s) {
  const t = trimStr(s);
  return !t
    || t === "PredictFun"
    || /^\d+$/.test(t)
    || /^市场\s*\d+$/i.test(t);
}

/** 从 Match / PfMarketId 抽出 marketId */
export function extractPfMarketIdHint(match, pfMarketId = "") {
  const mid = trimStr(pfMarketId);
  if (mid && /^\d+$/.test(mid))
    return mid;
  const m = trimStr(match);
  if (/^\d+$/.test(m))
    return m;
  const hit = /^市场\s*(\d+)$/i.exec(m);
  return hit ? hit[1] : "";
}

/** 超长链上 token、截断 token、或占位 */
export function isBarePfItemLabel(s, tokenId = "") {
  const t = trimStr(s);
  const tok = trimStr(tokenId);
  if (!t || t === "PredictFun")
    return true;
  if (tok && t === tok)
    return true;
  if (/^\d{16,}$/.test(t))
    return true;
  // 旧兜底「81019144…」
  if (/^\d{6,}…$/.test(t) || /^\d{6,}\.{3}$/.test(t))
    return true;
  return false;
}

export function isBarePfBetLabel(s) {
  const t = trimStr(s);
  return !t || t === "PredictFun";
}

/**
 * 从 MarketIndex 解析队伍/盘口名
 * @returns {{ match: string, bet: string, item: string } | null}
 */
export function labelsFromPredictFunMarketIndex({ marketId, tokenId } = {}) {
  const mid = trimStr(marketId);
  const tok = trimStr(tokenId);
  if (!mid && !tok)
    return null;

  let index;
  try {
    index = readPredictFunMarketIndex();
  }
  catch {
    return null;
  }
  const entries = index?.entries;
  if (!Array.isArray(entries) || !entries.length)
    return null;

  const entry = entries.find((e) => {
    const homeMid = trimStr(e?.homeMarketId);
    const awayMid = trimStr(e?.awayMarketId || e?.homeMarketId);
    const homeTok = trimStr(e?.homeTokenId);
    const awayTok = trimStr(e?.awayTokenId);
    if (mid && (mid === homeMid || mid === awayMid))
      return true;
    if (tok && (tok === homeTok || tok === awayTok))
      return true;
    return false;
  });
  if (!entry)
    return null;

  const home = trimStr(entry.homeName) || "主队";
  const away = trimStr(entry.awayName) || "客队";
  const homeTok = trimStr(entry.homeTokenId);
  const mapNum = Number(entry.map) || 0;
  const isHome = tok
    ? tok === homeTok
    : mid === trimStr(entry.homeMarketId);

  return {
    match: `${home} vs ${away}`,
    bet: mapNum > 0 ? `[地图${mapNum}] 获胜` : "全场胜负",
    item: isHome ? home : away,
  };
}

/**
 * 合并：客户端展示字段 > 索引 > 旧 RDS > 兜底
 * 注意：「市场 N」不算可读，会继续尝试索引升级
 */
export function resolvePfOrderLabels({
  marketId,
  tokenId,
  match,
  bet,
  item,
  fromClient,
} = {}) {
  const mid = trimStr(marketId) || extractPfMarketIdHint(match, marketId);
  const tok = trimStr(tokenId) || (
    isBarePfItemLabel(item) ? trimStr(item) : ""
  );
  const client = fromClient && typeof fromClient === "object" ? fromClient : {};
  const cMatch = trimStr(client.match ?? client.Match);
  const cBet = trimStr(client.bet ?? client.Bet);
  const cItem = trimStr(client.item ?? client.Item);

  const indexed = labelsFromPredictFunMarketIndex({ marketId: mid, tokenId: tok });

  const outMatch = !isBarePfMatchLabel(cMatch)
    ? cMatch
    : !isBarePfMatchLabel(match)
      ? trimStr(match)
      : (indexed?.match || (mid ? `市场 ${mid}` : "PredictFun"));

  const outBet = !isBarePfBetLabel(cBet)
    ? cBet
    : !isBarePfBetLabel(bet)
      ? trimStr(bet)
      : (indexed?.bet || "全场胜负");

  const outItem = !isBarePfItemLabel(cItem, tok)
    ? cItem
    : !isBarePfItemLabel(item, tok)
      ? trimStr(item)
      : (indexed?.item || (tok
        ? (tok.length > 8 ? `${tok.slice(0, 8)}…` : tok)
        : "—"));

  return { match: outMatch, bet: outBet, item: outItem };
}

/** 卖单 Item：在买单文案前加「平仓」 */
export function pfSellItemLabel(buyItem) {
  const t = trimStr(buyItem);
  if (!t || isBarePfItemLabel(t))
    return "平仓";
  if (t.startsWith("平仓"))
    return t;
  return `平仓 ${t}`;
}
