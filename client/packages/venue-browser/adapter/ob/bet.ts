import { parseVenueCreateAt } from "@changmen/shared/time/match_time";
import type { BetOption } from "@changmen/client-core/models/betOption";
import { BetResult } from "@changmen/client-core/models/betResult";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import type { PlatformProvider, VenueOrder, VenueOrderStatus } from "../contract";
import { accountGet, accountPostForm } from "./accountHttp";
import { formatDateKey, toFixed } from "@changmen/client-core/shared/format";
import { md5 } from "@changmen/client-core/shared/md5";
import { wait } from "@changmen/client-core/shared/wait";
import { PLATFORMS } from "../shared/platforms";

function noteObCheckFailure(account: PlatformAccount, msg: string) {
  if (/redis: nil/.test(msg)) {
    account.errorCount += 1;
    if (account.errorCount >= 3) {
      account.logout();
    }
  } else {
    account.errorCount = 0;
  }
}

const uidByAccount = new Map<number, string>();
const oddUpdateDone = new Set<number>();
/** 对齐 A8 `US`：下单成功后短时间 orderList(status=1) 重试策略 */
const betSuccessAtByAccount = new Map<number, number>();

const ORDER_LIST_MAX_RETRY = 3;
const ORDER_LIST_AFTER_BET_MS = 300_000;

type ObOrderListResponse = {
  status?: string;
  data?: { bet?: Array<Record<string, unknown>> };
};

function obNum(v: unknown): number {
  if (v && typeof (v as { toNumber?: () => number }).toNumber === "function") {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v) || 0;
}

/** 对齐 A8 `Pr.getCurrency` */
function obVenueCurrency(currencyEn?: string): string {
  if (!currencyEn) return "CNY";
  switch (String(currencyEn).toUpperCase()) {
    case "CNY":
    case "RMB":
      return "CNY";
    case "USD":
    case "USDT":
      return "USDT";
    default:
      return currencyEn;
  }
}

type ObBalanceResponse = {
  status?: string;
  data?: {
    balance?: number | string;
    currency_en?: string;
    uid?: string | number;
    account?: string;
    msg?: string;
    message?: string;
  } | string;
};

async function obMemberHeartbeat(account: PlatformAccount) {
  await accountGet(account, "/game/member/heartbeat");
}

/** 对齐 A8 `R7`：每账号成功一次 odd/updateType */
async function obEnsureOddUpdateType(account: PlatformAccount) {
  const oddKey = account.accountId ?? 0;
  if (oddUpdateDone.has(oddKey)) return;
  const res = await accountGet<ObBalanceResponse>(account, "/game/odd/updateType?odd_update_type=2");
  if (res.status === "true") {
    oddUpdateDone.add(oddKey);
  }
}

function obOrderListTimeRange(): { begin: string; end: string } {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const today = new Date();
  return {
    begin: `${formatDateKey(yesterday)} 00:00:00`,
    end: `${formatDateKey(today)} 23:59:59`,
  };
}

function mapObBetStatus(raw: unknown): { status: VenueOrderStatus; money: number } {
  let money = 0;
  let status: VenueOrderStatus = "none";
  switch (Number(raw)) {
    case 2:
      status = "reject";
      break;
    case 4:
    case 7:
      status = "return";
      break;
    case 5:
      status = "win";
      break;
    case 6:
      status = "lose";
      break;
    default:
      status = "none";
  }
  return { status, money };
}

function mapObOrderRow(row: Record<string, unknown>, provider: PlatformAccount["provider"]): VenueOrder {
  const teams = String(row.team_cn_names ?? "")
    .split(",")
    .map((t) => t.replace(/&nbsp;/g, " "));
  const round = obNum(row.round);
  const stageLabel = round === 0 ? "全场" : `地图${round}`;
  const marketName = String(row.market_cn_name ?? "").replace(/&nbsp;/g, " ");
  let item = String(row.odd_name ?? "");
  if (item === "@T1") item = teams[0] ?? item;
  if (item === "@T2") item = teams[1] ?? item;

  const betMoney = obNum(row.bet_amount);
  const reward = obNum(row.win_amount);
  let { status, money } = mapObBetStatus(row.bet_status);
  if (status === "win" || status === "lose") {
    money = reward - betMoney;
  }

  const createAt = parseVenueCreateAt(row.bet_time);

  return {
    provider: provider ?? PLATFORMS.OB,
    orderId: String(row.id ?? ""),
    odds: obNum(row.odd),
    createAt,
    betMoney,
    reward,
    money,
    status,
    game: String(row.game_id ?? ""),
    match: teams.join(" vs "),
    bet: `[${stageLabel}]${marketName}`,
    item,
  };
}

/** 对齐 A8 `yYe.getOrders` 内 `s(status, attempt)` */
async function fetchObOrderList(
  account: PlatformAccount,
  status: 1 | 2,
  attempt = 0,
): Promise<ObOrderListResponse | null> {
  if (attempt >= ORDER_LIST_MAX_RETRY) return null;

  const { begin, end } = obOrderListTimeRange();
  const qs = new URLSearchParams({
    page: "1",
    page_size: "20",
    begin_time: begin,
    end_time: end,
    status: String(status),
  });

  try {
    const data = await accountGet<ObOrderListResponse>(
      account,
      `/game/orderList?${qs.toString()}`,
      { forceDirect: true },
    );

    if (!data || data.status !== "true" || status !== 1) {
      return data;
    }

    if (account.accountId) {
      const lastBet = betSuccessAtByAccount.get(account.accountId) ?? 0;
      if (Date.now() - lastBet > ORDER_LIST_AFTER_BET_MS) {
        return data;
      }
      if (data.data?.bet?.length) {
        betSuccessAtByAccount.delete(account.accountId);
      }
    }

    if (data.data?.bet?.length) {
      return data;
    }
    return fetchObOrderList(account, status, attempt + 1);
  } catch {
    await wait(5000);
    return fetchObOrderList(account, status, attempt + 1);
  } finally {
    await wait(1000);
  }
}

function secretKey(account: PlatformAccount, timeStamp: number) {
  const uid = uidByAccount.get(account.accountId) || "";
  return md5(`${account.token}_${timeStamp}_${uid}_`);
}

function formatOdd(n: number) {
  return Number(n).toFixed(3);
}

function buildBetLine(option: BetOption, amount: number, odds: number) {
  return `mch=${option.matchId}&mkt=${option.betId}&oid=${option.itemId}&odd=${formatOdd(odds)}&a=${Math.round(amount)}&bt=1`;
}

export const obProvider: PlatformProvider = {
  async getBalance(account) {
    const bal = await accountGet<ObBalanceResponse>(account, "/game/balance");
    if (bal.status !== "true") {
      // 抛出场馆文案，供余额刷新区分鉴权失败 vs 瞬时不可用
      const raw = bal.data;
      let reason = "game/balance failed";
      if (typeof raw === "string" && raw.trim())
        reason = raw;
      else if (raw && typeof raw === "object")
        reason = String(raw.msg ?? raw.message ?? reason);
      throw new Error(reason);
    }
    const data = typeof bal.data === "object" && bal.data ? bal.data : undefined;
    const venueMemberId = data?.uid != null && data.uid !== ""
      ? String(data.uid).trim()
      : undefined;
    const venueAccountName = data?.account != null && String(data.account).trim()
      ? String(data.account).trim()
      : undefined;
    if (account.accountId && venueMemberId) {
      uidByAccount.set(account.accountId, venueMemberId);
    }
    // odd/updateType、heartbeat 失败不应吞掉已成功的 balance（否则定时 Io.f 会误显 TOKEN ERROR）
    if (!oddUpdateDone.has(account.accountId ?? 0)) {
      try {
        await obEnsureOddUpdateType(account);
      }
      catch {
        /* ignore */
      }
    }
    try {
      await obMemberHeartbeat(account);
    }
    catch {
      /* ignore */
    }
    return {
      balance: Number(data?.balance) || 0,
      currency: obVenueCurrency(data?.currency_en),
      venueMemberId,
      venueAccountName,
    };
  },

  async getOrders(account) {
    const byId = new Map<string, VenueOrder>();
    for (const status of [1, 2] as const) {
      const res = await fetchObOrderList(account, status);
      if (!res || res.status !== "true") continue;
      for (const row of res.data?.bet ?? []) {
        const order = mapObOrderRow(row, account.provider);
        if (!order.orderId || byId.has(order.orderId)) continue;
        byId.set(order.orderId, order);
      }
    }

    return [...byId.values()].sort((a, b) => b.createAt - a.createAt);
  },

  async checkBet(account, option) {
    const oddsAtStart = option.odds;
    const timeStamp = Math.floor(new Date().getTime() / 1000);
    if (!option.loseOrder) {
      const probeBody = {
        c: 1,
        "b[0]": buildBetLine(option, 1, oddsAtStart),
        types: 1,
        time_stamp: timeStamp,
        secret_key: secretKey(account, timeStamp),
      };
      const probe = await accountPostForm<{ status?: string; data?: string }>(
        account,
        "/game/bet",
        probeBody,
        { forceDirect: true },
      );
      option.response = probe;
      const msg = String(probe.data || "");

      // [A8 可证实] yYe：仅 Minimum 继续；其余一律 return（不看 status）
      if (/Minimum|最小投注金额/.test(msg)) {
        option.newOdds = 0;
      } else {
        option.newOdds = oddsAtStart;
        option.checkError = msg || `status=${probe.status ?? "?"}`;
        noteObCheckFailure(account, msg);
        if (msg === "请勿重复提交") {
          await wait(3000);
        } else if (msg === "Odds error" || msg === "赔率错误") {
          option.newOdds = Number(toFixed(option.odds * 0.99, 3));
        } else {
          option.newOdds = 0;
        }
        option.updateOdds(option.newOdds);
        return option;
      }
      account.errorCount = 0;
    }

    option.data = {
      c: 1,
      "b[0]": buildBetLine(option, option.betMoney, option.odds),
      types: 1,
      time_stamp: timeStamp,
      secret_key: secretKey(account, timeStamp),
    };
    return option;
  },

  async betting(account, option) {
    const body = option.data as Record<string, string | number>;
    const res = await accountPostForm<{ status?: string; data?: string }>(
      account,
      "/game/bet",
      body,
    );
    if (res.data === "Odds error" || res.data === "赔率错误") {
      option.updateOdds(Number(toFixed(option.odds * 0.99, 3)));
    }
    const ok = res.status === "true";
    if (ok && account.accountId) {
      betSuccessAtByAccount.set(account.accountId, Date.now());
    }
    return new BetResult(account.provider, ok, res.data, body, res);
  },
};
