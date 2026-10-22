import { parseVenueCreateAt } from "@changmen/shared/time/match_time";
import type { BetOption } from "@changmen/client-core/models/betOption";
import { BetResult } from "@changmen/client-core/models/betResult";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import {
  sortVenueOrdersNewestFirst,
  type PlatformProvider,
  type VenueOrder,
  type VenueOrderStatus,
} from "../contract";
import { accountGet, accountPostForm } from "./accountHttp";
import { getCurrency } from "@changmen/shared/currency";
import { PLATFORMS } from "../shared/platforms";
import { useMessageStore } from "../shared/webBridge";

interface RayOddsRow {
  odds_id: string | number;
  enable_parlay?: number;
  status?: number;
  odds?: number | string;
  bet_limit?: [number, number];
  group_name?: string;
  name?: string;
  match_name?: string;
  match_stage?: string;
  odds_group_id?: number;
  value?: unknown;
  win?: unknown;
  last_update?: unknown;
  group_short_name?: string;
  id?: number;
  team_id?: number;
  match_id?: number;
  tag?: unknown;
  game_id?: number;
  start_time?: string;
}

interface RayOrderDetail {
  title?: string;
  odds?: number | string;
  stake?: number;
  game_id?: number | string;
  match_name?: string;
  match_stage?: string;
  match_id?: string | number;
  odds_id?: string | number;
  comment?: string;
}

interface RayOrderRow {
  order_number?: string | number;
  status?: number;
  win?: number;
  total_bonus?: number;
  create_time?: string;
  settle_time?: string;
  detail?: RayOrderDetail[];
}

function mapRayOrderRow(row: RayOrderRow): VenueOrder | null {
  const detail = row.detail?.[0];
  if (!detail) return null;

  let status: VenueOrderStatus = "none";
  let money = 0;
  const stake = Number(detail.stake) || 0;
  const totalBonus = Number(row.total_bonus) || 0;

  if (row.status === 0) {
    status = "none";
  } else if (row.status === 1) {
    money = totalBonus - stake;
    if (row.win === 1) status = "win";
    else if (row.win === 0) status = "lose";
  } else if (row.status === 4) {
    status = "reject";
  }

  const titleParts = String(detail.title ?? "").split("\n");
  let bet = titleParts.join(" ");
  let item = "";
  if (titleParts.length === 2) {
    bet = titleParts[0] ?? "";
    item = titleParts[1] ?? "";
  }

  return {
    provider: PLATFORMS.RAY,
    orderId: String(row.order_number ?? ""),
    odds: Number(detail.odds) || 0,
    createAt: parseVenueCreateAt(row.create_time),
    game: String(detail.game_id ?? ""),
    match: String(detail.match_name ?? ""),
    bet: `${detail.match_stage ?? ""} ${bet}`.trim(),
    item,
    betMoney: stake,
    reward: totalBonus,
    status,
    money,
    // [changmen 扩展] 保留场馆身份和拒单说明，避免实时检测结果丢失；不改状态判定。
    venueMatchId: detail.match_id == null ? undefined : String(detail.match_id),
    venueItemId: detail.odds_id == null ? undefined : String(detail.odds_id),
    venueRejectReason: status === "reject" && typeof detail.comment === "string" ? detail.comment : undefined,
    venueSettledAt: row.settle_time ? parseVenueCreateAt(row.settle_time) : undefined,
  };
}

type RayOddsGetRes = {
  code?: number;
  result?: { odds?: RayOddsRow[]; start_time?: string } | null;
};

function findRayOddsRow(res: RayOddsGetRes, itemId: string): RayOddsRow | undefined {
  return res.result?.odds?.find((d) => d?.odds_id == itemId);
}

/** [changmen 扩展] 用户确认修复 A8 空盘口缺陷：失效旧报价和旧订单，等待采集恢复有效赔率。 */
function rejectMissingRayQuote(option: BetOption, reason: string): BetOption {
  option.data = null;
  option.checkError = `RAY 无盘口数据：${reason}`;
  option.updateOdds(0);
  return option;
}

function applyRayLockAndLimit(
  account: PlatformAccount,
  option: BetOption,
  row: RayOddsRow | undefined,
): row is RayOddsRow {
  if (!row || row.enable_parlay !== 1 || row.status !== 1) {
    // [A8 可证实] 已有盘口的封盘分支仍按原版执行；缺项由入口单独失效旧报价。
    option.checkError = `${row!.match_name} / [${row!.match_stage}] ${row!.group_name} / ${row!.name}@${row!.odds} 已封盘`;
    option.updateOdds(0);
    return false;
  }
  const betMin = row.bet_limit![0];
  const betMax = row.bet_limit![1];
  if (option.betMoney < betMin || option.betMoney > betMax) {
    option.checkError = useMessageStore().limitMessage(account, {
      match: option.match?.title,
      bet: option.bet?.getBetName(),
      odds: option.odds,
      betMoney: option.betMoney,
      limit: betMax,
    });
    return false;
  }
  return true;
}

function buildRayOrderData(
  option: BetOption,
  row: RayOddsRow,
  matchStartTime: string | undefined,
): Record<string, unknown> {
  // [A8 可证实] rHe.checkBet：完整盘口快照直接成为 /v2/order 的 order JSON。
  const stake = Math.round(option.betMoney);
  const title = `${row.group_name}\n${row.name}`;
  return {
    total_stake: stake.toString(),
    total_bet_bonus: (stake * option.odds).toFixed(2),
    order: [
      {
        number: 1,
        oddsId: option.itemId,
        title,
        order_type: 0,
        stake: stake.toString(),
        order_detail: {
          odds_group_id: row.odds_group_id,
          value: row.value,
          win: row.win,
          status: 1,
          bet_limit: row.bet_limit,
          last_update: row.last_update,
          match_stage: row.match_stage,
          match_name: row.match_name,
          group_name: row.group_name,
          group_short_name: row.group_short_name,
          id: row.id,
          odds_id: row.odds_id,
          team_id: row.team_id,
          name: row.name,
          match_id: row.match_id,
          odds: option.odds,
          tag: row.tag,
          enable_parlay: row.enable_parlay,
          game_id: row.game_id,
          start_time: row.start_time,
          title,
          isLive: new Date(matchStartTime!).getTime() < Date.now(),
        },
        betMin: row.bet_limit![0],
        betMax: row.bet_limit![1],
      },
    ],
  };
}

/** [A8 可证实] vYe：`${account.gateway}/v2/...` */
const RAY_A8_V2 = {
  user: "/v2/user",
  odds: (matchId: string) => `/v2/odds?match_id=${matchId}`,
  order: "/v2/order",
} as const;

export const rayProvider: PlatformProvider = {
  async getBalance(account) {
    const res = await accountGet<{
      code?: number;
      result?: {
        balance?: number | string;
        id?: number | string;
        nickname?: string;
        username?: string;
      };
    }>(
      account,
      RAY_A8_V2.user,
    );
    if (!res || res.code !== 200) return undefined;
    const result = res.result;
    const venueMemberId = result?.id != null && result.id !== ""
      ? String(result.id).trim()
      : undefined;
    const venueAccountName = String(result?.nickname || result?.username || result?.id || "").trim()
      || undefined;
    return {
      balance: Number(result?.balance) || 0,
      currency: getCurrency(),
      venueMemberId,
      venueAccountName,
    };
  },

  async checkBet(account, option) {
    const res = await accountGet<RayOddsGetRes>(
      account,
      RAY_A8_V2.odds(String(option.matchId)),
      { forceDirect: true },
    );
    option.response = res;
    if (!res) return rejectMissingRayQuote(option, "响应为空");
    // [A8 可证实] rHe.checkBet：业务失败及超出跌价容差时直接返回，不新增错误或清理旧 data。
    if (res.code !== 200) return option;

    if (!Array.isArray(res.result?.odds))
      return rejectMissingRayQuote(option, "响应缺少有效盘口列表");
    const row = findRayOddsRow(res, option.itemId);
    option.response = row ?? res;
    if (!row) return rejectMissingRayQuote(option, "当前选项已不存在");
    if (row.enable_parlay === 1 && row.status === 1
      && (!Array.isArray(row.bet_limit) || row.bet_limit.length < 2
        || row.bet_limit.slice(0, 2).some(value => value == null || !Number.isFinite(Number(value)))))
      return rejectMissingRayQuote(option, "盘口缺少有效限额");
    if (row.enable_parlay === 1 && row.status === 1
      && (!Number.isFinite(Number(row.odds)) || Number(row.odds) <= 0))
      return rejectMissingRayQuote(option, "盘口缺少有效赔率");
    if (!applyRayLockAndLimit(account, option, row)) return option;

    const liveOdds = Number(row.odds);
    option.updateOdds(liveOdds);
    if (option.odds > liveOdds + 0.01) return option;
    option.odds = liveOdds;
    option.data = buildRayOrderData(option, row, res.result!.start_time);
    return option;
  },

  async getOrders(account) {
    const res = await accountGet<{ code?: number; result?: RayOrderRow[] }>(
      account,
      RAY_A8_V2.order,
      { forceDirect: true },
    );
    if (res.code !== 200 || !Array.isArray(res.result)) return [];
    const orders: VenueOrder[] = [];
    for (const row of res.result) {
      const mapped = mapRayOrderRow(row);
      if (mapped) orders.push(mapped);
    }
    return sortVenueOrdersNewestFirst(orders);
  },

  async betting(account, option) {
    const res = await accountPostForm<{ code?: number; desc?: string; result?: unknown }>(
      account,
      RAY_A8_V2.order,
      { order: JSON.stringify(option.data) },
    );
    let message: string | null = null;
    let newOdds = 0;
    switch (res.code) {
      case 501:
        newOdds =
          Number(
            res.result &&
              Array.isArray(res.result) &&
              res.result.length &&
              (res.result[0] as RayOddsRow).odds,
          ) || 0;
        message = `赔率下降至${newOdds || ""}`;
        break;
      case 200:
        message = `当前余额:${res.result}`;
        break;
      default:
        newOdds = 0;
        break;
    }
    option.updateOdds(newOdds);
    return new BetResult(
      account.provider,
      Boolean(res && res.code === 200),
      message || res.desc || "",
      option.data,
      res,
    );
  },
};
