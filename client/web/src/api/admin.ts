import type { TradeRemoteAccount } from "@/realtime/userChannel";
import type {
  AdminAccountDetail,
  AdminAccountListRow,
  AdminDashboard,
  AdminMaintenanceReport,
  AdminOrderLogLookup,
  AdminOrderMatrix,
  AdminOrderPage,
  AdminOrderRow,
  AdminUserConfigDetail,
  AdminUserRow,
} from "@/types/admin";
import type { PlatformId } from "@/types/esport";
import type { MonthReportPayload } from "@/types/monthReport";

import { post, unwrap } from "@/api/client";
import { filterAdminOrdersBelongingToDate } from "@/shared/adminOrderDisplay";

export async function getAdminDashboard(date?: string) {
  return unwrap(await post<AdminDashboard>("Client_AdminDashboard", date ? { date } : {}));
}

export async function getAdminUsers(date?: string) {
  return unwrap(await post<AdminUserRow[]>("Client_AdminUsers", date ? { date } : {}));
}

export async function getAdminUserConfigDetail(userId: string) {
  return unwrap(
    await post<AdminUserConfigDetail>("Client_AdminUserConfigDetail", { userId }),
  );
}

export async function getAdminOrders(body: Record<string, unknown> = {}) {
  return unwrap(await post<AdminOrderPage>("Client_AdminOrders", body));
}

/** 拉取筛选条件下当日全部订单（自动合并分页；pageSize 与后端上限 5000 对齐） */
export async function getAdminOrdersAll(body: Record<string, unknown> = {}) {
  const all: AdminOrderRow[] = [];
  const seen = new Set<string>();
  let pageIndex = 1;
  const pageSize = 5000;
  let dateKey = "";
  for (;;) {
    const page = await getAdminOrders({ ...body, pageIndex, pageSize });
    dateKey = page.date;
    for (const row of page.list ?? []) {
      const key = row.id != null
        ? `id:${row.id}`
        : `oid:${row.userId}:${row.orderId}`;
      if (seen.has(key))
        continue;
      seen.add(key);
      all.push(row);
    }
    // hasMore/total 按 SQL create_at 分页；enrich 可能整页滤空，不能靠 list.length===0 停
    const size = Number(page.pageSize) || pageSize;
    const sqlTotal = Number(page.total) || 0;
    const hasMore = typeof page.hasMore === "boolean"
      ? page.hasMore
      : pageIndex * size < sqlTotal;
    if (!hasMore)
      break;
    pageIndex += 1;
    if (pageIndex > 50)
      break;
  }
  const homeDate = String(body.date || dateKey || "");
  const list = homeDate ? filterAdminOrdersBelongingToDate(all, homeDate) : all;
  return { date: dateKey || homeDate, list, total: list.length };
}

/** 拉取当日全部订单（优先矩阵 API；旧后端无此 action 时分页兜底） */
export async function getAdminOrdersMatrix(body: Record<string, unknown> = {}) {
  try {
    return unwrap(await post<AdminOrderMatrix>("Client_AdminOrdersMatrix", body));
  }
  catch (e) {
    const msg = String((e as Error).message || "");
    if (!msg.includes("unknown action"))
      throw e;
    return getAdminOrdersAll(body);
  }
}

export interface AdminUserMutationResult {
  id: string;
  userName: string;
  frozen?: number;
  isAdmin?: number;
}

export async function setAdminUserAdmin(userId: string, isAdmin: boolean) {
  return unwrap(
    await post<AdminUserMutationResult>("Client_AdminSetUserAdmin", { userId, isAdmin }),
  );
}

export async function setAdminUserRole(
  userId: string,
  role: string,
  teamId?: string | null,
) {
  return unwrap(
    await post<AdminUserMutationResult>("Client_AdminSetUserRole", {
      userId,
      role,
      teamId: teamId ?? null,
    }),
  );
}

export interface TeamRow {
  id: string;
  name: string;
  created_at?: number;
  updated_at?: number;
}

export async function getTeams(): Promise<TeamRow[]> {
  return unwrap(await post<TeamRow[]>("Client_AdminTeams", {}));
}

export async function upsertTeam(id: string, name: string) {
  return unwrap(await post<TeamRow>("Client_AdminUpsertTeam", { id, name }));
}

export async function deleteTeam(id: string) {
  return unwrap(await post<{ id: string }>("Client_AdminDeleteTeam", { id }));
}

export async function deleteAdminUser(userId: string) {
  return unwrap(
    await post<AdminUserMutationResult>("Client_AdminDeleteUser", { userId }),
  );
}

export async function createAdminUser(userName: string, password: string) {
  return unwrap(
    await post<AdminUserMutationResult>("Client_AdminCreateUser", { userName, password }),
  );
}

export async function resetAdminUserPassword(userId: string, password: string) {
  return unwrap(
    await post<AdminUserMutationResult>("Client_AdminResetPassword", { userId, password }),
  );
}

export async function updateAdminAccountMultiply(body: {
  userId: string;
  accountId: number;
  multiply: number;
}) {
  return unwrap(
    await post<AdminAccountDetail>("Client_AdminUpdateAccountMultiply", body),
  );
}

export interface AdminAccountRow extends AdminAccountDetail {
  userId: string;
  userName: string;
  teamId?: string | null;
}

export async function getAdminAccounts() {
  return unwrap(await post<AdminAccountListRow[]>("Client_AdminAccounts", {}));
}

export interface AdminPredictFunMemberRow {
  userId: string;
  userName: string;
  teamId?: string | null;
  memberName: string;
  hasAccount: boolean;
  accountId: number;
  /** 当前余额（players.total_balance） */
  balance: number;
  maxBalance: number;
  multiply: number;
  pause: boolean;
  today: number;
  totalProfit: number;
  description: string;
  currency: string;
  updateTime: number;
  account?: AdminAccountDetail | null;
}

export async function getAdminPredictFunMembers() {
  return unwrap(await post<AdminPredictFunMemberRow[]>("Client_AdminPredictFunMembers", {}));
}

export interface AdminPredictFunFeeConfig {
  buyFeeRateBps: number;
  sellFeeRateBps: number;
  buyFeeRatePercent: number;
  sellFeeRatePercent: number;
  updatedAt?: number | null;
}

export async function getAdminPredictFunFeeConfig() {
  return unwrap(await post<AdminPredictFunFeeConfig>("Client_AdminGetPredictFunFeeConfig", {}));
}

export async function saveAdminPredictFunFeeConfig(body: {
  buyFeeRatePercent?: number;
  sellFeeRatePercent?: number;
  buyFeeRateBps?: number;
  sellFeeRateBps?: number;
}) {
  return unwrap(await post<AdminPredictFunFeeConfig>("Client_AdminSavePredictFunFeeConfig", body));
}

export async function ensureAdminPredictFunHouseAccount(userId: string) {
  return unwrap(
    await post<{ created: boolean; account: AdminAccountDetail }>(
      "Client_AdminEnsurePredictFunHouseAccount",
      { userId },
    ),
  );
}

export async function rechargeAdminPredictFunMember(body: {
  userId: string;
  accountId: number;
  amount: number;
  description?: string;
}) {
  return unwrap(
    await post<{
      ok: boolean;
      amount: number;
      balanceBefore: number;
      balance: number;
      log: { ID?: number; logId?: number; Money?: number; money?: number; Description?: string; description?: string; CreateAt?: number; createAt?: number };
      info?: { accountId: number; balance: number; currency?: string };
    }>("Client_AdminPredictFunRecharge", body),
  );
}

export async function getAdminPredictFunMoneyLogs(body: {
  userId: string;
  accountId: number;
  pageIndex?: number;
  pageSize?: number;
}) {
  return unwrap(
    await post<{
      list?: Array<Record<string, unknown>>;
      data?: Array<Record<string, unknown>>;
      total?: number;
      RecordCount?: number;
    }>("Client_AdminPredictFunMoneyLogs", body),
  );
}

/** PF 会员全部历史订单（不分日） */
export async function getAdminPredictFunMemberOrders(body: {
  userId: string;
  accountId: number;
}) {
  return unwrap(
    await post<{ list?: AdminOrderRow[]; total?: number }>(
      "Client_AdminPredictFunMemberOrders",
      body,
    ),
  );
}

export async function updateAdminAccountFields(body: {
  userId: string;
  accountId: number;
  /** 非 PF：授信；PF 禁止经此改余额，请用 rechargeAdminPredictFunMember */
  balance?: number;
  credit?: number;
  maxBalance?: number;
  pause?: boolean;
  multiply?: number;
  description?: string;
}) {
  const { userId, accountId, balance, credit, maxBalance, pause, multiply, description } = body;
  // form-urlencoded 下嵌套对象会变成 JSON 字符串；扁平字段更稳
  const patch: Record<string, unknown> = {};
  if (balance !== undefined)
    patch.balance = balance;
  if (credit !== undefined)
    patch.credit = credit;
  if (maxBalance !== undefined)
    patch.maxBalance = maxBalance;
  if (pause !== undefined)
    patch.pause = pause;
  if (multiply !== undefined)
    patch.multiply = multiply;
  if (description !== undefined)
    patch.description = description;
  return unwrap(
    await post<AdminAccountDetail>("Client_AdminUpdateAccountFields", {
      userId,
      accountId,
      patch,
    }),
  );
}

export interface AdminUserSettingMutationResult {
  id: string;
  userName: string;
  betTarget?: boolean;
  setting: Record<string, unknown>;
}

export async function updateAdminUserBetTarget(userId: string, betTarget: boolean) {
  return unwrap(
    await post<AdminUserSettingMutationResult>("Client_AdminUpdateUserBetTarget", {
      userId,
      betTarget: betTarget ? 1 : 0,
    }),
  );
}

export async function getAdminUserTradeAccounts(userId: string, provider: PlatformId) {
  return unwrap(
    await post<TradeRemoteAccount[]>("Client_AdminUserTradeAccounts", { userId, provider }),
  );
}

export async function renameAdminUser(userId: string, userName: string) {
  return unwrap(
    await post<AdminUserMutationResult>("Client_AdminRenameUser", { userId, userName }),
  );
}

export async function getAdminMonthReport(month?: string, userId?: string, teamId?: string) {
  const body: Record<string, string> = {};
  if (month)
    body.month = month;
  if (userId)
    body.userId = userId;
  if (teamId)
    body.teamId = teamId;
  return unwrap(await post<MonthReportPayload>("Client_AdminMonthReport", body));
}

export async function deleteAdminOrders(orderIds: number[]) {
  return unwrap(
    await post<{ deleted: number }>("Client_AdminDeleteOrders", { orderIds }),
  );
}

export interface PlatformAnalyticsRow {
  provider: string;
  total_orders: number;
  wins: number;
  losses: number;
  rejects: number;
  pending: number;
  total_bet: number;
  total_profit: number;
}

export interface ArbPairRow {
  provider_a: string;
  provider_b: string;
  /** 去重后的买×买配对数（已排除 PM/PF 卖单双计） */
  pair_count: number;
  /** 一胜一负 */
  hedge_ok: number;
  /** provider_a 赢 / provider_b 输 */
  a_win_b_lose: number;
  /** provider_a 输 / provider_b 赢 */
  a_lose_b_win: number;
  /** 两腿均为 Win/Lose */
  settled_pairs: number;
  both_win: number;
  both_lose: number;
  has_reject: number;
  rejects_a: number;
  rejects_b: number;
  pending_pairs: number;
  /** @deprecated 非拒单组（含未结算）；请用 hedge_ok / settled_pairs */
  both_settled: number;
  net_profit: number;
  total_bet: number;
  profit_hedge: number;
  /** A赢B输 双腿净利 */
  profit_a_win_b_lose: number;
  /** A输B赢 双腿净利 */
  profit_a_lose_b_win: number;
  profit_reject: number;
  profit_both_lose: number;
  profit_both_win: number;
  profit_pending: number;
  wins_a: number;
  losses_a: number;
  profit_a: number;
  bet_a: number;
  wins_b: number;
  losses_b: number;
  profit_b: number;
  bet_b: number;
}

export interface GameAnalyticsRow {
  game: string;
  total_orders: number;
  wins: number;
  losses: number;
  rejects: number;
  total_bet: number;
  total_profit: number;
}

export interface HourlyAnalyticsRow {
  hour: number;
  total_orders: number;
  wins: number;
  losses: number;
  total_profit: number;
  total_bet: number;
}

export interface AccountAnalyticsRow {
  player_id: number;
  provider: string;
  total_orders: number;
  wins: number;
  losses: number;
  rejects: number;
  total_bet: number;
  total_profit: number;
}

export interface ArbOddsBucketRow {
  other_provider: string;
  /** 锚定平台（OB/RAY）一侧结算状态 */
  anchor_status: "Win" | "Lose";
  anchor_odds_bucket: string;
  count: number;
  avg_anchor_odds: number;
  avg_other_odds: number;
  /** 该区间套利对双腿净利（CNY；与套利配对表同口径） */
  profit: number;
  /** 对手腿 Win 单量（在锚定侧已为本行 status 的前提下） */
  other_wins: number;
  /** 对手腿 Lose 单量 */
  other_losses: number;
  /** 对手 Win 时的双腿净利 */
  profit_other_win: number;
  /** 对手 Lose 时的双腿净利 */
  profit_other_lose: number;
}

export interface ArbOddsSummaryRow {
  other_provider: string;
  anchor_status: "Win" | "Lose";
  count: number;
  avg_anchor_odds: number;
  avg_other_odds: number;
  min_anchor_odds: number;
  max_anchor_odds: number;
  /** 该组合套利对双腿净利（CNY；与套利配对表同口径） */
  profit: number;
  other_wins: number;
  other_losses: number;
  profit_other_win: number;
  profit_other_lose: number;
}

export interface ArbOddsAnalyticsPayload {
  buckets: ArbOddsBucketRow[];
  summary: ArbOddsSummaryRow[];
}

/** 正 EV 单边：按场馆汇总（含均赔） */
export interface ValueBetProviderRow extends PlatformAnalyticsRow {
  avg_odds: number;
}

/** 正 EV 单边：场馆 × 赔率区间 */
export interface ValueBetOddsBucketRow extends ValueBetProviderRow {
  odds_bucket: string;
}

export interface ValueBetOrderAnalyticsPayload {
  startMs?: number;
  endMs?: number;
  byProvider: ValueBetProviderRow[];
  byOddsBucket: ValueBetOddsBucketRow[];
}

export interface PlatformAnalyticsPayload {
  startMs: number;
  endMs: number;
  platforms: PlatformAnalyticsRow[];
  pairs: ArbPairRow[];
  games: GameAnalyticsRow[];
  hourly: HourlyAnalyticsRow[];
  accounts: AccountAnalyticsRow[];
  obArbOdds?: ArbOddsAnalyticsPayload;
  rayArbOdds?: ArbOddsAnalyticsPayload;
}

export async function getAdminPlatformAnalytics(body: Record<string, unknown> = {}) {
  return unwrap(await post<PlatformAnalyticsPayload>("Client_AdminPlatformAnalytics", body));
}

/** [changmen 扩展] 正 EV 历史：场馆 × 赔率区间 */
export async function getAdminValueBetAnalytics(body: Record<string, unknown> = {}) {
  return unwrap(await post<ValueBetOrderAnalyticsPayload>("Client_AdminValueBetAnalytics", body));
}

export interface PolymarketBuilderTradeRow {
  id: string;
  tradeType: string;
  side: string;
  status: string;
  outcome: string;
  price: number;
  sizeShares: number;
  sizeUsdc: number;
  feeUsdc: number;
  builderFeeUsdc: number;
  /** 优先 builderFee，否则 feeUsdc */
  displayFeeUsdc: number;
  maker: string;
  /** maker 地址对应的 changmen 用户名 */
  makerUserName: string;
  owner: string;
  market: string;
  assetId: string;
  transactionHash: string;
  matchTime: number | null;
  matchTimeIso: string | null;
  builder: string;
}

export interface PolymarketChangmenOrderRow {
  orderId: string;
  userId: string;
  userName: string;
  playerId: number;
  playerName: string;
  status: string;
  betMoney: number;
  profit: number;
  odds: number;
  /** CLOB 成交价 0–1 */
  price: number;
  /** 比赛类型，如 cs2 / lol */
  game: string;
  pmSide: string;
  pmShares: number;
  pmStakeUsdc: number;
  pmSellState: "" | "open" | "partial" | "closed" | "settled";
  pmAttributedSellShares: number;
  /** 卖单 → 父买单 orderId（合并展示用） */
  pmBuyOrderId?: string;
  /** 买单最近一笔卖单 orderId */
  pmLastSellOrderId?: string;
  /** 买单累计卖出回款 USDC */
  pmSellProceeds?: number;
  /** Phase 1 减仓事件（买单 raw） */
  positionEvents?: {
    sells?: Array<{
      id: string;
      at?: number;
      shares?: number;
      price?: number;
      proceeds?: number;
      pnl?: number;
      origin?: "changmen" | "external";
    }>;
  };
  /** 赛果（持有到期）：win/lose，与 status/money 脱钩 */
  pmMatchResult: string;
  matchTitle: string;
  betTitle: string;
  item: string;
  createAt: number;
  updateAt: number;
}

export interface PolymarketAnalyticsSummary {
  groupCount: number;
  arbGroupCount: number;
  singleLegCount: number;
  soldCloseCount: number;
  winCount: number;
  loseCount: number;
  winRate: number;
  totalPmBet: number;
  /** 假使持仓到结算的理论盈亏（非实际卖出 Money） */
  totalHoldProfit: number;
  /** holdProfit / pmBet */
  roi: number;
}

export interface PolymarketPriceBandRow {
  price_band: string;
  group_count: number;
  win_count: number;
  lose_count: number;
  win_rate: number;
  pm_bet: number;
  hold_profit: number;
  avg_fill_price: number;
  roi: number;
}

export interface PolymarketVenueRoiRow {
  other_provider: string;
  group_count: number;
  win_count: number;
  lose_count: number;
  win_rate: number;
  pm_bet: number;
  hold_profit: number;
  avg_fill_price: number;
  roi: number;
}

export interface PolymarketOrderAnalyticsPayload {
  summary: PolymarketAnalyticsSummary;
  priceBands: PolymarketPriceBandRow[];
  venues: PolymarketVenueRoiRow[];
}

export interface PolymarketBuilderDashboardPayload {
  startMs: number;
  endMs: number;
  range?: {
    kind: string;
    timezone: string | null;
    label: string;
    dateKey: string | null;
    monthKey: string | null;
    weekStartKey: string | null;
    weekEndKey: string | null;
    startIso: string;
    endIso: string;
  };
  builderCode: string;
  relayerConfigured: boolean;
  relayerAuthMode: string | null;
  polymarket: {
    trades: PolymarketBuilderTradeRow[];
    summary: {
      tradeCount: number;
      volumeUsdc: number;
      feeUsdc: number;
      builderFeeUsdc: number;
      buyCount: number;
      sellCount: number;
      buyVolumeUsdc: number;
      sellVolumeUsdc: number;
      buyFeeUsdc: number;
      sellFeeUsdc: number;
      buyBuilderFeeUsdc: number;
      sellBuilderFeeUsdc: number;
    };
    pagesFetched: number;
    nextCursor: string | null;
    hasMore: boolean;
    /** CLOB 直连失败时仍返回页面，归因成交为空 */
    fetchError?: string;
  };
  changmen: {
    orders: PolymarketChangmenOrderRow[];
    summary: {
      orderCount: number;
      totalBet: number;
      totalProfit: number;
      wins: number;
      losses: number;
      rejects: number;
      pending: number;
    };
    analytics: PolymarketOrderAnalyticsPayload;
  };
}

export async function getAdminPolymarketBuilder(body: Record<string, unknown> = {}) {
  return unwrap(await post<PolymarketBuilderDashboardPayload>("Client_AdminPolymarketBuilder", body));
}

/** Link / order_id 关联 Client_SaveUserLog（管理端诊断） */
export async function getAdminOrderLogs(body: {
  userId: string;
  linkId?: number;
  orderId?: string;
  domain?: string;
  sport?: string;
  venue?: string;
  paddingMs?: number;
  logLimit?: number;
}) {
  return unwrap(await post<AdminOrderLogLookup>("Client_AdminOrderLogs", body));
}

/** 订单和用户维护：共用投注账号 + order_id 重复诊断 */
export async function getAdminMaintenance() {
  return unwrap(await post<AdminMaintenanceReport>("Client_AdminMaintenance", {}));
}
