import * as sb from "@changmen/db";
import { isAdminUser } from "../../auth/admin_auth.js";
import { resolveVisibleUserIds } from "../../auth/role_filter.js";
import { resolvePolymarketBuilderCode } from "./builder_code.js";
import { describeBuilderTradesFetchError, fetchAllBuilderTrades, summarizeBuilderTrades } from "./builder_trades.js";
import { collectPolymarketUserAddresses, parsePolymarketTokenConfig } from "./clob_l2.js";
import { isPolymarketRelayerConfigured, getPolymarketRelayerAuthMode } from "./relayer_config.js";

function normalizeEthAddress(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(s) ? s : "";
}

/** Polymarket 钱包/funder 地址 → changmen 用户名（如 gb12） */
export function buildPolymarketAddressUserIndex(profiles = []) {
  const out = new Map();
  for (const profile of profiles) {
    const userName = String(profile.user_name ?? profile.userName ?? "").trim();
    if (!userName)
      continue;
    const accounts = Array.isArray(profile.accounts) ? profile.accounts : [];
    for (const acc of accounts) {
      if (String(acc?.provider ?? "").trim().toLowerCase() !== "polymarket")
        continue;
      indexPolymarketAccountCredentials(userName, acc, out, null);
    }
  }
  return out;
}

function indexPolymarketAccountCredentials(userName, acc, byAddress, byOwner) {
  const config = parsePolymarketTokenConfig(acc?.token);
  for (const addr of collectPolymarketUserAddresses(config)) {
    if (byAddress)
      byAddress.set(addr, userName);
  }
  for (const raw of [
    acc?.walletAddress,
    acc?.address,
    acc?.funder,
    acc?.funderAddress,
    config?.walletAddress,
    config?.address,
    config?.funder,
    config?.funderAddress,
  ]) {
    const addr = normalizeEthAddress(raw);
    if (addr && byAddress)
      byAddress.set(addr, userName);
  }
  if (!byOwner)
    return;
  const apiCreds = config?.apiCreds && typeof config.apiCreds === "object"
    ? config.apiCreds
    : config;
  for (const raw of [
    apiCreds?.apiKey,
    apiCreds?.key,
    apiCreds?.api_key,
    config?.apiKey,
    config?.key,
    acc?.venueMemberId,
    acc?.venueId,
  ]) {
    const key = String(raw ?? "").trim().toLowerCase();
    if (key)
      byOwner.set(key, userName);
  }
}

/**
 * Builder 成交用户反查：优先 owner（CLOB apiKey），其次 maker（proxy/funder 地址）。
 * 账号真相在 players.account_data；profiles.accounts 仅作兼容回退。
 */
export function buildPolymarketTradeUserIndex({ playerRows = [], profiles = [] } = {}) {
  const byAddress = new Map();
  const byOwner = new Map();

  for (const row of playerRows) {
    const userName = String(row.user_name ?? "").trim();
    if (!userName)
      continue;
    const acc = row.account_data && typeof row.account_data === "object"
      ? row.account_data
      : {};
    indexPolymarketAccountCredentials(
      userName,
      {
        ...acc,
        venueMemberId: row.venue_member_id || acc.venueMemberId,
      },
      byAddress,
      byOwner,
    );
  }

  for (const [addr, userName] of buildPolymarketAddressUserIndex(profiles)) {
    if (!byAddress.has(addr))
      byAddress.set(addr, userName);
  }

  return { byAddress, byOwner };
}

function resolveTradeUserName(trade, index) {
  const ownerKey = String(trade?.owner ?? "").trim().toLowerCase();
  if (ownerKey && index.byOwner.has(ownerKey))
    return index.byOwner.get(ownerKey);
  const addr = normalizeEthAddress(trade?.maker);
  return addr ? (index.byAddress.get(addr) || "") : "";
}

/** form-urlencoded 会把 boolean 变成字符串 `"true"`，不能只认严格 true */
function wantsAllRange(body = {}) {
  const v = body.all;
  if (v === true || v === 1 || v === "1" || v === "true" || v === "yes")
    return true;
  return body.period === "all" || body.range === "all";
}

const DAY_MS = 86400000;

/** YYYY-MM-DD → [y, m, d]，非法时回退到 UTC/本地今天 */
function parseYmd(raw, fallbackUtc = true) {
  const parts = String(raw ?? "").trim().split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (
    parts.length >= 3
    && Number.isFinite(y) && y >= 1970
    && Number.isFinite(m) && m >= 1 && m <= 12
    && Number.isFinite(d) && d >= 1 && d <= 31
  ) {
    return { y, m, d };
  }
  if (fallbackUtc) {
    const now = new Date();
    return { y: now.getUTCFullYear(), m: now.getUTCMonth() + 1, d: now.getUTCDate() };
  }
  const now = new Date();
  return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
}

function formatYmdUtc(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Polymarket 官网日榜口径：UTC 自然日
 * [date 00:00:00.000Z, next day 00:00:00.000Z)
 */
export function utcDayRange(dateKey) {
  const { y, m, d } = parseYmd(dateKey, true);
  const startMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  return {
    startMs,
    endMs: startMs + DAY_MS,
    kind: "utcDay",
    timezone: "utc",
    dateKey: formatYmdUtc(startMs),
    label: `UTC日 ${formatYmdUtc(startMs)}（00:00Z–次日00:00Z）`,
  };
}

/**
 * Polymarket 官网周奖励 epoch：Sunday 00:00 UTC → Saturday 23:59 UTC
 * 实现为半开区间 [周日00:00Z, 下周日00:00Z)
 */
export function utcWeekRange(anchorDateKey) {
  const { y, m, d } = parseYmd(anchorDateKey, true);
  const anchorMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  const dow = new Date(anchorMs).getUTCDay(); // 0=Sunday
  const startMs = anchorMs - dow * DAY_MS;
  const endMs = startMs + 7 * DAY_MS;
  const startKey = formatYmdUtc(startMs);
  const endInclusiveKey = formatYmdUtc(endMs - 1);
  return {
    startMs,
    endMs,
    kind: "utcWeek",
    timezone: "utc",
    dateKey: formatYmdUtc(anchorMs),
    weekStartKey: startKey,
    weekEndKey: endInclusiveKey,
    label: `UTC周 ${startKey}–${endInclusiveKey}（周日00:00Z–周六23:59Z）`,
  };
}

/**
 * UTC 自然月：[当月1日 00:00Z, 次月1日 00:00Z)
 */
export function utcMonthRange(monthKey) {
  const parts = String(monthKey ?? "").split("-").map(Number);
  const now = new Date();
  const y = Number.isFinite(parts[0]) && parts[0] >= 1970 ? parts[0] : now.getUTCFullYear();
  const m = Number.isFinite(parts[1]) && parts[1] >= 1 && parts[1] <= 12
    ? parts[1]
    : now.getUTCMonth() + 1;
  const startMs = Date.UTC(y, m - 1, 1, 0, 0, 0, 0);
  const endMs = Date.UTC(y, m, 1, 0, 0, 0, 0);
  const key = `${y}-${String(m).padStart(2, "0")}`;
  return {
    startMs,
    endMs,
    kind: "utcMonth",
    timezone: "utc",
    monthKey: key,
    label: `UTC月 ${key}（1日00:00Z–次月1日00:00Z）`,
  };
}

function resolvePeriod(body = {}) {
  return String(body.period || body.range || "").trim().toLowerCase();
}

function parseRange(body = {}) {
  if (wantsAllRange(body)) {
    return {
      startMs: 0,
      endMs: Date.now() + DAY_MS,
      kind: "all",
      timezone: null,
      label: "全部时段",
    };
  }
  if (body.startMs && body.endMs) {
    return {
      startMs: Number(body.startMs),
      endMs: Number(body.endMs),
      kind: "custom",
      timezone: null,
      label: "自定义区间",
    };
  }

  const period = resolvePeriod(body);
  // 对齐 Polymarket 官网：UTC 日 / UTC 周 / UTC 月
  if (period === "utcday" || period === "utc_day" || period === "utc-day")
    return utcDayRange(body.date);
  if (period === "utcweek" || period === "utc_week" || period === "utc-week")
    return utcWeekRange(body.date);
  if (
    period === "utcmonth"
    || period === "utc_month"
    || period === "utc-month"
    || period === "month"
    || body.month
  ) {
    return utcMonthRange(body.month);
  }
  return utcDayRange(body.date);
}

/** orders.match / bet：PM 多为纯文本标题；其它场馆偶发 JSON `{Title}` */
function parseOrderTextField(raw) {
  if (raw == null)
    return "";
  if (typeof raw === "object" && !Array.isArray(raw))
    return String(raw.Title || raw.title || "").trim();
  const s = String(raw).trim();
  if (!s)
    return "";
  if (s.startsWith("{")) {
    try {
      const o = JSON.parse(s);
      return String(o?.Title || o?.title || s).trim();
    }
    catch { /* plain text */ }
  }
  return s;
}

function resolveOrderGame(row, matchTitle) {
  const fromCol = String(row.game || "").trim();
  if (fromCol)
    return fromCol;
  const raw = row.raw && typeof row.raw === "object" && !Array.isArray(row.raw) ? row.raw : {};
  const fromRaw = String(raw.game || "").trim();
  if (fromRaw)
    return fromRaw;
  // 卖单 raw.game 常空：从 "Counter-Strike: Team vs …" 抽前缀
  const m = String(matchTitle || "").match(/^([^:：]{2,40})\s*[:：]/);
  return m ? m[1].trim() : "";
}

function mapChangmenOrder(row) {
  const raw = row.raw && typeof row.raw === "object" && !Array.isArray(row.raw) ? row.raw : {};
  const matchTitle = parseOrderTextField(row.match);
  const betTitle = parseOrderTextField(row.bet);
  const fillPrice = Number(row.fill_price ?? raw.pmFillPrice);
  const sellState = String(raw.pmSellState || "").trim();
  return {
    orderId: row.order_id,
    userId: row.user_id,
    userName: row.user_name || "",
    playerId: row.player_id,
    playerName: row.player_name || "",
    status: row.status,
    betMoney: Number(row.bet_money) || 0,
    profit: Number(row.money) || 0,
    odds: Number(row.odds) || 0,
    price: Number.isFinite(fillPrice) && fillPrice > 0 ? fillPrice : 0,
    game: resolveOrderGame(row, matchTitle),
    pmSide: String(row.pm_side || raw.pmSide || "").trim(),
    pmShares: Number(raw.pmShares) || 0,
    pmStakeUsdc: Number(raw.pmStakeUsdc) || 0,
    pmSellState: sellState === "open"
      || sellState === "partial"
      || sellState === "closed"
      || sellState === "settled"
      ? sellState
      : "",
    pmAttributedSellShares: Number(raw.pmAttributedSellShares) || 0,
    pmBuyOrderId: String(raw.pmBuyOrderId || "").trim(),
    pmLastSellOrderId: String(raw.pmLastSellOrderId || "").trim(),
    pmSellProceeds: (() => {
      const n = Number(raw.pmSellProceeds);
      return Number.isFinite(n) && n > 0 ? n : 0;
    })(),
    positionEvents: (() => {
      const pe = raw.positionEvents;
      if (!pe || typeof pe !== "object" || Array.isArray(pe))
        return undefined;
      const sells = Array.isArray(pe.sells) ? pe.sells : [];
      const cleaned = sells.map((ev) => {
        if (!ev || typeof ev !== "object")
          return null;
        const id = String(ev.id || "").trim();
        if (!id)
          return null;
        const out = { id };
        if (ev.at != null)
          out.at = Number(ev.at) || 0;
        if (ev.shares != null)
          out.shares = Number(ev.shares);
        if (ev.price != null)
          out.price = Number(ev.price);
        if (ev.proceeds != null)
          out.proceeds = Number(ev.proceeds);
        if (ev.pnl != null)
          out.pnl = Number(ev.pnl);
        const origin = String(ev.origin || "").toLowerCase();
        if (origin === "changmen" || origin === "external")
          out.origin = origin;
        return out;
      }).filter(Boolean);
      return cleaned.length ? { sells: cleaned } : undefined;
    })(),
    pmMatchResult: (() => {
      const m = String(raw.pmMatchResult || "").trim().toLowerCase();
      return m === "win" || m === "lose" || m === "equal_split" ? m : "";
    })(),
    matchTitle,
    betTitle,
    item: String(row.item || "").trim(),
    createAt: Number(row.create_at) || 0,
    updateAt: Number(row.update_at) || Number(row.create_at) || 0,
  };
}

/**
 * Builder 看板：Polymarket 归因成交 + changmen Polymarket 订单对照。
 */
export async function getPolymarketBuilderDashboard(body = {}, caller = null) {
  const range = parseRange(body);
  const { startMs, endMs } = range;
  const afterSec = Math.floor(startMs / 1000);
  const beforeSec = Math.floor(endMs / 1000);
  const maxPages = Number(body.maxPages) || 5;
  const maxTrades = Number(body.maxTrades) || 5000;
  const orderLimit = Math.min(Math.max(Number(body.orderLimit) || 500, 1), 500);

  let userIds;
  const builderCode = resolvePolymarketBuilderCode();
  const [polyWrap, allProfiles, pmPlayerRows] = await Promise.all([
    fetchAllBuilderTrades({ afterSec, beforeSec, maxPages, maxTrades })
      .then(result => ({ result, fetchError: "" }))
      .catch((err) => {
        const fetchError = describeBuilderTradesFetchError(err);
        console.warn("[poly-builder]", fetchError);
        return {
          result: {
            trades: [],
            summary: summarizeBuilderTrades([]),
            pagesFetched: 0,
            nextCursor: null,
            hasMore: false,
          },
          fetchError,
        };
      }),
    sb.fetchProfilesAdmin(),
    sb.fetchPolymarketPlayersForTradeLookup(),
  ]);
  const polyResult = polyWrap.result;

  if (caller && !isAdminUser(caller)) {
    const visibleIds = resolveVisibleUserIds(caller, allProfiles);
    if (visibleIds)
      userIds = [...visibleIds];
  }

  const [changmenRows, changmenSummary, changmenAnalytics] = await Promise.all([
    sb.fetchPolymarketOrdersInRange(startMs, endMs, userIds, orderLimit),
    sb.fetchPolymarketOrderStatsInRange(startMs, endMs, userIds),
    sb.fetchPolymarketOrderAnalytics(startMs, endMs, userIds),
  ]);
  const changmenOrders = changmenRows.map(mapChangmenOrder);
  const tradeUserIndex = buildPolymarketTradeUserIndex({
    playerRows: pmPlayerRows,
    profiles: allProfiles,
  });
  const trades = polyResult.trades.map(t => ({
    ...t,
    makerUserName: resolveTradeUserName(t, tradeUserIndex),
  }));

  return {
    startMs,
    endMs,
    range: {
      kind: range.kind,
      timezone: range.timezone,
      label: range.label,
      dateKey: range.dateKey || null,
      monthKey: range.monthKey || null,
      weekStartKey: range.weekStartKey || null,
      weekEndKey: range.weekEndKey || null,
      startIso: new Date(startMs).toISOString(),
      endIso: new Date(endMs).toISOString(),
    },
    builderCode,
    relayerConfigured: isPolymarketRelayerConfigured(),
    relayerAuthMode: getPolymarketRelayerAuthMode(),
    polymarket: {
      ...polyResult,
      trades,
      summary: polyResult.summary,
      fetchError: polyWrap.fetchError || "",
    },
    changmen: {
      orders: changmenOrders,
      summary: changmenSummary,
      analytics: changmenAnalytics,
    },
  };
}
