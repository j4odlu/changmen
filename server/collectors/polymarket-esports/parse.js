/**
 * Polymarket 电竞 discovery 解析（**唯一权威**）。
 * VPS collector：Gamma → platform_* + MarketIndex。
 * 浏览器不跑本文件；`packages/venue-adapter/polymarket/parse.ts` **只**保留报价/订单工具，
 * 禁止再镜像 `buildPolymarketMappedMarket`。
 */

import { truncateOddsTo3 } from "@changmen/shared/odds_format";

const PLATFORM = "Polymarket";
const YES_NO = /^(yes|no|是|否)$/i;
const WINNER_RE = /winner|win|胜者|获胜|moneyline/i;

export function parseJsonArray(raw) {
  if (Array.isArray(raw))
    return raw.map(String);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    }
    catch {
      return [];
    }
  }
  return [];
}

function tagsText(tags) {
  if (!Array.isArray(tags))
    return "";
  return tags.map(t => String(t?.label ?? t?.slug ?? t?.name ?? t ?? "")).join(" ");
}

function eventText(events) {
  if (!Array.isArray(events))
    return "";
  return events.map((raw) => {
    if (!raw || typeof raw !== "object")
      return "";
    const metadata = raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {};
    const seriesText = Array.isArray(raw.series)
      ? raw.series.map(s => String(s?.title ?? s?.slug ?? "")).join(" ")
      : String(raw.series?.title ?? raw.series?.slug ?? "");
    return [
      raw.title,
      raw.slug,
      raw.ticker,
      raw.seriesSlug,
      metadata.league,
      metadata.tournament,
      seriesText,
    ].filter(Boolean).join(" ");
  }).join(" ").toLowerCase();
}

export function mapPolymarketGameId(market) {
  const text = [
    tagsText(market.tags),
    eventText(market.events),
    market.sports_market_type,
    market.sportsMarketType,
    market.question,
    market.title,
    market.slug,
    market.group_item_title,
    market.groupItemTitle,
  ].filter(Boolean).join(" ").toLowerCase();

  if (/\bleague[-\s]+of[-\s]+legends\b|\blol\b/.test(text))
    return "lol";
  if (/\bdota[-\s]*2?\b/.test(text))
    return "dota2";
  if (/\bcs2\b|\bcsgo\b|counter[-\s]?strike/.test(text))
    return "cs2";
  if (/\bhonor[-\s]+of[-\s]+kings\b|\bking[-\s]+of[-\s]+glory\b|\bkings[-\s]+of[-\s]+glory\b|\bhok\b|\bkog\b|王者荣耀/.test(text))
    return "kog";
  if (/\bvalorant\b/.test(text))
    return "valorant";
  return null;
}

function marketIdOf(market) {
  return String(market.condition_id ?? market.conditionId ?? market.market ?? market.id ?? "");
}

function eventOf(market) {
  const events = Array.isArray(market.events) ? market.events : [];
  const event = events[0];
  return event && typeof event === "object" ? event : null;
}

function sourceMatchIdOf(market, marketId) {
  const event = eventOf(market);
  return String(event?.id ?? event?.slug ?? marketId);
}

export function normalizePolymarketTeamName(name) {
  const normalized = String(name || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\u4E00-\u9FFF]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "unknown";
}

export function sourceTeamId(gameId, name) {
  return `${gameId}:${normalizePolymarketTeamName(name)}`;
}

function startTimeOf(market) {
  const raw = market.game_start_time ?? market.gameStartTime ?? market.startDate ?? market.start_date;
  if (raw === undefined || raw === null || raw === "")
    return Date.now();
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0)
    return numeric > 1e12 ? numeric : numeric * 1000;
  const parsed = Date.parse(String(raw));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function isOpenMarket(market) {
  if (market.active === false)
    return false;
  if (market.closed || market.archived)
    return false;
  if (market.accepting_orders === false || market.acceptingOrders === false)
    return false;
  return true;
}

function mapNumberOf(market) {
  const type = String(market.sports_market_type ?? market.sportsMarketType ?? "").toLowerCase();
  const groupTitle = String(market.group_item_title ?? market.groupItemTitle ?? "").trim().toLowerCase();
  if (groupTitle === "match winner")
    return 0;
  const groupMap = /^(?:map|game)\s*(\d+)\s+winner$/.exec(groupTitle);
  if (groupMap)
    return Number(groupMap[1]);

  const text = [
    type,
    market.question,
    market.title,
  ].filter(Boolean).join(" ");
  if (type === "moneyline" && WINNER_RE.test(text))
    return 0;
  if (type === "child_moneyline") {
    const questionMap = /\b(?:map|game)\s*(\d+)\s+winner\b/i.exec(text);
    if (questionMap)
      return Number(questionMap[1]);
  }
  return null;
}

function betNameOf(map) {
  return map > 0 ? `[地图${map}] 获胜者` : "[全场] 获胜者";
}

export function decimalOddsFromProbability(price) {
  const value = Number(price);
  if (!Number.isFinite(value) || value <= 0 || value >= 1)
    return 0;
  return truncateOddsTo3(1 / value);
}

/** 与浏览器订单结算一致：价决阈值 0.99 */
const WINNER_PRICE_MIN = 0.99;

/**
 * 以 PM 为准解析该市场胜负（相对 clob_token_ids[0]=home / [1]=away）。
 * @param {object} market
 * @returns {{ mapOutcome: "home"|"away", outcomeKind: "official"|"price" } | null}
 */
export function resolvePolymarketMapMarketOutcome(market) {
  const assetIds = parseJsonArray(market?.clob_token_ids ?? market?.clobTokenIds);
  if (assetIds.length < 2)
    return null;
  const homeId = String(assetIds[0] ?? "").trim();
  const awayId = String(assetIds[1] ?? "").trim();
  if (!homeId || !awayId)
    return null;

  const tokens = Array.isArray(market?.tokens) ? market.tokens : [];
  const winning = tokens.find(t => t?.winner === true);
  if (winning) {
    const id = String(winning.token_id ?? winning.tokenId ?? "").trim();
    if (id && id === homeId)
      return { mapOutcome: "home", outcomeKind: "official" };
    if (id && id === awayId)
      return { mapOutcome: "away", outcomeKind: "official" };
  }

  // [changmen 扩展] 全场高价格只表示预期，不能代替官方胜负（例如 BO5 仍为 2–0）。
  if (mapNumberOf(market) === 0)
    return null;

  const prices = parseJsonArray(market?.outcomePrices ?? market?.outcome_prices).map(Number);
  for (let i = 0; i < prices.length; i++) {
    const price = prices[i];
    if (!Number.isFinite(price) || price < WINNER_PRICE_MIN)
      continue;
    if (i === 0)
      return { mapOutcome: "home", outcomeKind: "price" };
    if (i === 1)
      return { mapOutcome: "away", outcomeKind: "price" };
  }
  return null;
}

/**
 * @param {object} market
 * @param {Record<string, number|string>} [buyPrices]
 */
export function buildPolymarketMappedMarket(market, buyPrices = {}) {
  if (!isOpenMarket(market))
    return null;
  const map = mapNumberOf(market);
  if (map === null)
    return null;

  const assetIds = parseJsonArray(market.clob_token_ids ?? market.clobTokenIds);
  const outcomes = parseJsonArray(market.outcomes);
  if (assetIds.length !== 2 || outcomes.length !== 2)
    return null;
  if (outcomes.some(name => YES_NO.test(String(name).trim())))
    return null;

  const marketId = marketIdOf(market);
  const gameId = mapPolymarketGameId(market);
  if (!marketId || !gameId)
    return null;

  const [homeId, awayId] = assetIds;
  const [homeName, awayName] = outcomes.map(String);
  const sourceMatchId = sourceMatchIdOf(market, marketId);
  const startTime = startTimeOf(market);
  const matchHomeId = sourceTeamId(gameId, homeName);
  const matchAwayId = sourceTeamId(gameId, awayName);

  const homeOdds = decimalOddsFromProbability(buyPrices[homeId]);
  const awayOdds = decimalOddsFromProbability(buyPrices[awayId]);
  const locked = !homeOdds || !awayOdds;
  const event = eventOf(market);
  const pandascoreId = event?.gameId ? Number(event.gameId) : undefined;
  const outcome = resolvePolymarketMapMarketOutcome(market);
  const resolutionSourceRaw = event?.resolutionSource ?? market?.resolutionSource;
  const resolutionSource = resolutionSourceRaw != null && String(resolutionSourceRaw).trim()
    ? String(resolutionSourceRaw).trim()
    : undefined;
  const eventSlugRaw = event?.slug != null ? String(event.slug).trim() : "";
  const eventSlug = eventSlugRaw && eventSlugRaw !== sourceMatchId ? eventSlugRaw : undefined;

  return {
    marketId,
    assetIds: [homeId, awayId],
    gameId: pandascoreId,
    ...(outcome ? { mapOutcome: outcome.mapOutcome, outcomeKind: outcome.outcomeKind } : {}),
    ...(resolutionSource ? { resolutionSource } : {}),
    ...(eventSlug ? { eventSlug } : {}),
    match: {
      Type: PLATFORM,
      SourceMatchID: sourceMatchId,
      SourceGameID: gameId,
      StartTime: startTime,
      HomeID: matchHomeId,
      Home: homeName,
      AwayID: matchAwayId,
      Away: awayName,
      Teams: [
        { Type: PLATFORM, TeamID: matchHomeId, Name: homeName, GameID: gameId, Logo: "" },
        { Type: PLATFORM, TeamID: matchAwayId, Name: awayName, GameID: gameId, Logo: "" },
      ],
    },
    bet: {
      Type: PLATFORM,
      SourceMatchID: sourceMatchId,
      SourceBetID: marketId,
      Map: map,
      BetName: betNameOf(map),
      SourceHomeID: homeId,
      HomeName: homeName,
      HomeOdds: homeOdds,
      SourceAwayID: awayId,
      AwayName: awayName,
      AwayOdds: awayOdds,
      Status: locked ? "Locked" : "Normal",
    },
  };
}
