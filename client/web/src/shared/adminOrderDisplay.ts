import type { AdminAccountDetail, AdminOrderRow } from "@/types/admin";
import type { OrderRow } from "@/types/order";
import {
  isArbGroup,
  normalizeOrderStatus,
  orderLegendModifier,
  orderLegendText,
  orderStatusClass,
} from "@/shared/orderDisplay";
import {
  alignPredictionSellLinksToBuys,
  countPrimaryOrderRows,
  filterOrdersBelongingToDate,
  groupOrdersByLink,
  isPredictionSellRow,
  orderLinkMapEntries,
} from "@/shared/orderLink";
import { accountOrderDisplayName } from "@/shared/accountDisplayName";

export { isArbGroup, orderLegendText, orderStatusClass };

/** 管理端订单笔数：排除 PM/PF 卖单（与侧栏 countPrimaryOrderRows 同口径） */
export function countAdminPrimaryOrders(
  orders: AdminOrderRow[],
  accounts: AdminAccountDetail[] = [],
): number {
  return countPrimaryOrderRows(orders.map(row => adminOrderToOrderRow(row, accounts)));
}

export function isAdminPredictionSellOrder(
  row: AdminOrderRow,
  accounts: AdminAccountDetail[] = [],
): boolean {
  return isPredictionSellRow(adminOrderToOrderRow(row, accounts));
}

interface AdminOrderDisplayAccount {
  accountId: number;
  platform?: string;
  provider?: string;
}

function normalizeStatus(raw: string): OrderRow["Status"] {
  return normalizeOrderStatus(raw);
}

export function adminOrderDisplayProvider(
  row: AdminOrderRow,
  accounts: AdminOrderDisplayAccount[] = [],
): string {
  const account = accounts.find(a => Number(a.accountId) === Number(row.playerId));
  return account?.platform || account?.provider || row.provider;
}

export function adminOrderToOrderRow(
  row: AdminOrderRow,
  accounts: AdminOrderDisplayAccount[] = [],
): OrderRow {
  // Polymarket / PredictFun 必须 Type 固定，否则 OrderList 不进专用模板
  const provider = String(row.provider || "").trim();
  const type = provider === "Polymarket" || provider === "PredictFun"
    ? provider
    : adminOrderDisplayProvider(row, accounts);
  return {
    OrderID: row.orderId,
    Link: row.linkId,
    Type: type,
    Match: row.match,
    Bet: row.bet,
    Item: row.item,
    Odds: row.odds,
    BetMoney: row.betMoney,
    Money: row.money,
    Status: normalizeStatus(row.status),
    CreateAt: row.createAt,
    PlayerID: row.playerId,
    Domain: row.domain,
    Sport: row.sport,
    Source: row.source,
    Game: row.game,
    PmTokenId: row.pmTokenId,
    PmShares: row.pmShares,
    PmFillPrice: row.pmFillPrice,
    PmStakeUsdc: row.pmStakeUsdc,
    PmFeeUsdc: row.pmFeeUsdc,
    PmConditionId: row.pmConditionId,
    PmOrigin: row.pmOrigin,
    PmAttributedSellShares: row.pmAttributedSellShares,
    PmRealizedPnlUsdc: row.pmRealizedPnlUsdc,
    PmSellProceeds: row.pmSellProceeds,
    PmLastSellOrderId: row.pmLastSellOrderId,
    PmSellState: row.pmSellState,
    PmSide: row.pmSide,
    ...(row.pmGtcExecutionId ? { PmGtcExecutionId: row.pmGtcExecutionId, PmGtcBuyShares: row.pmGtcBuyShares } : {}),
    PmBuyOrderId: row.pmBuyOrderId,
    PfSide: row.pfSide,
    PfBuyOrderId: row.pfBuyOrderId,
    PfSellState: row.pfSellState,
    PfShares: row.pfShares,
    PfHoldShares: row.pfHoldShares,
    PfNotionalUsdt: row.pfNotionalUsdt,
    PfFillCostUsdt: row.pfFillCostUsdt,
    PfBookPrice: row.pfBookPrice,
    PfTokenId: row.pfTokenId,
    PfMarketId: row.pfMarketId,
    PfSellOrderId: row.pfSellOrderId,
    PfSellProceeds: row.pfSellProceeds,
    PfFeeAmountWei: row.pfFeeAmountWei,
    PfFeeType: row.pfFeeType,
    PfFeeUsdt: row.pfFeeUsdt,
    PfFeeRateBps: row.pfFeeRateBps,
    PfChangmenCodeFeeRateBps: row.pfChangmenCodeFeeRateBps,
    PfChangmenCodeFeeShares: row.pfChangmenCodeFeeShares,
    PfChangmenCodeFeeUsdt: row.pfChangmenCodeFeeUsdt,
    PositionEvents: row.positionEvents,
  };
}

function adminOrderHomeKey(row: AdminOrderRow): string {
  return `${Number(row.linkId) || 0}|${String(row.orderId ?? "").trim().toLowerCase()}|${Number(row.createAt) || 0}`;
}

/** 管理端按日列表：同 Link 整组只留在开弓日（不依赖后端是否已重启） */
export function filterAdminOrdersBelongingToDate(
  list: AdminOrderRow[],
  dateKey: string,
): AdminOrderRow[] {
  if (!dateKey)
    return list || [];
  const mapped = (list || []).map(row => adminOrderToOrderRow(row));
  const kept = new Set(
    filterOrdersBelongingToDate(mapped, dateKey).map(r =>
      `${Number(r.Link) || 0}|${String(r.OrderID ?? "").trim().toLowerCase()}|${Number(r.CreateAt) || 0}`),
  );
  return (list || []).filter(row => kept.has(adminOrderHomeKey(row)));
}

export function adminPlayerLabel(
  row: OrderRow,
  accounts: AdminAccountDetail[],
  historical?: {
    platformName?: string | null;
    playerName?: string | null;
    venueAccountName?: string | null;
    playerDeleted?: boolean | null;
  } | null,
): string {
  const pid = Number(row.PlayerID) || 0;
  const acc = accounts.find(a => Number(a.accountId) === pid);
  const deleted = Boolean(historical?.playerDeleted)
    || Boolean(acc && acc.active === false && acc.description === "已删除");

  if (acc) {
    const platform = acc.platformName || acc.platform || row.Type || "";
    const base = `${platform} / ${accountOrderDisplayName(acc)}`;
    return deleted ? `${base}（已删）` : base;
  }
  const histName = accountOrderDisplayName({
    venueAccountName: historical?.venueAccountName || undefined,
    playerName: historical?.playerName || undefined,
    accountId: pid,
  });
  if (histName) {
    const platform = String(historical?.platformName || row.Type || "").trim();
    const base = platform ? `${platform} / ${histName}` : histName;
    return deleted ? `${base}（已删）` : base;
  }
  if (row.Type)
    return String(row.Type);
  return pid ? `#${pid}` : "";
}

/** 已删/不在活跃列表时的展示用账号 stub（仅管理端订单归属） */
export function adminAccountStubFromOrder(row: AdminOrderRow): AdminAccountDetail | null {
  const accountId = Number(row.playerId) || 0;
  if (!accountId)
    return null;
  const playerName = String(row.playerName || "").trim();
  const platformName = String(row.platformName || "").trim();
  const venueAccountName = String(row.venueAccountName || "").trim();
  if (!playerName && !platformName && !venueAccountName)
    return null;
  return {
    accountId,
    platform: String(row.provider || platformName || ""),
    platformId: 0,
    platformName: platformName || String(row.provider || ""),
    playerName: playerName || venueAccountName || `#${accountId}`,
    balance: 0,
    credit: 0,
    currency: "CNY",
    winBalance: 0,
    unsettle: 0,
    proxyId: 0,
    pause: false,
    markupOnly: false,
    noMarkup: false,
    active: false,
    minOdds: 0,
    maxOdds: 0,
    minDefault: 0,
    maxDefault: 0,
    profit: 0,
    maxProfit: 0,
    maxBetCount: 0,
    maxOrder: 0,
    todayOrder: 0,
    today: 0,
    orderCount: 0,
    totalProfit: 0,
    maxBalance: 0,
    maxWinBalance: 0,
    description: row.playerDeleted ? "已删除" : "",
    realName: "",
    mobile: "",
    city: "",
    multiply: 1,
    maxBalanceOdds: 2,
    lastOdds: false,
    workTimes: [],
    rateConfig: [],
    game: {},
    gatewayHost: "",
    hasCredentials: false,
    updateTime: 0,
    ...(venueAccountName ? { venueAccountName } : {}),
  };
}

export function mergeAdminAccountsWithOrderHistory(
  accounts: AdminAccountDetail[],
  orders: AdminOrderRow[],
): AdminAccountDetail[] {
  const byId = new Map<number, AdminAccountDetail>();
  for (const acc of accounts || []) {
    const id = Number(acc.accountId) || 0;
    if (id)
      byId.set(id, acc);
  }
  for (const row of orders || []) {
    const id = Number(row.playerId) || 0;
    if (!id || byId.has(id))
      continue;
    const stub = adminAccountStubFromOrder(row);
    if (stub)
      byId.set(id, stub);
  }
  return [...byId.values()];
}

export function orderLegendClass(rows: OrderRow[]) {
  return `admin-order-link__legend--${orderLegendModifier(rows)}`;
}

export function groupAdminOrderEntries(
  orders: AdminOrderRow[],
  accounts: AdminOrderDisplayAccount[] = [],
) {
  // 卖单 Link 对齐到父买单，再分组，否则软附属跨不了 fieldset
  const map = groupOrdersByLink(
    alignPredictionSellLinksToBuys(orders.map(row => adminOrderToOrderRow(row, accounts))),
  );
  return orderLinkMapEntries(map).map(([link, orderRows]) => {
    const byId = new Map(orders.map(o => [o.orderId, o]));
    const adminRows = orderRows
      .map(r => byId.get(String(r.OrderID ?? "")))
      .filter((r): r is AdminOrderRow => Boolean(r));
    return { link, orderRows, adminRows };
  });
}
