import { getVenueOddsLimit, setVenueOddsLimit } from "@changmen/client-core/bridge/oddsAccess";
import type { BetOption } from "@changmen/client-core/models/betOption";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { BetResult } from "@changmen/client-core/models/betResult";
import { parseVenueCreateAt } from "@changmen/shared/time/match_time";
import type { PlatformProvider, VenueOrder } from "../contract";
import { useMatchStore } from "../shared/webBridge";
import { useMessageStore } from "../shared/webBridge";

import type { LimitEntry } from "@changmen/client-core/types/limit";
import { imSportIdForGame, imSupportedGameIds, signImPayload } from "./sign";
import { accountImPost } from "./accountHttp";
import { formatDateKey } from "@changmen/client-core/shared/format";

function compactTimestamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** 对齐 A8 Wy() */
function buildImAccountHeaders(account: PlatformAccount): Record<string, string> {
  const gateway = (account.gateway || "").replace(/\/$/, "");
  return {
    "Content-Type": "application/json; charset=UTF-8",
    Referer: `${gateway}/`,
    Origin: gateway,
    "x-requested-with": "XMLHttpRequest",
    msuv: "2.0",
    cbv: `203_50_bmv2_${compactTimestamp()}`,
  };
}

function imAccountUrl(account: PlatformAccount, path: string): string {
  const base = (account.gateway || "").replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

interface ImBalanceResponse {
  StatusCode?: number;
  StatusDesc?: string;
  MemberBalances?: Array<{ Currency?: string; AvailableBalance?: number | string }>;
}

interface ImBetInfoResponse {
  StatusCode?: number;
  StatusDesc?: string;
  Hash?: string;
  ServerTicks?: number;
  BetInfos?: Array<{
    StatusCode?: number;
    StatusDesc?: string;
    MinStake?: number;
    MaxStake?: number;
    Odds?: number;
  }>;
}

interface ImPlaceBetResponse {
  StatusCode?: number;
  StatusDesc?: string;
  Odds?: number | string;
}

interface ImBetStatementResponse {
  StatusCode?: number;
  StatusDesc?: string;
  BetStatements?: Array<{
    BetId?: string | number;
    Odds?: number | string;
    BetDate?: string | number;
    Stake?: number | string;
    Return?: number | string;
    IsCancelled?: boolean;
    IsSettled?: boolean;
    WinLose?: number;
    BetDetails?: Array<{
      SName?: string;
      HTName?: string;
      ATName?: string;
      SportName?: string;
      GTName?: string;
    }>;
  }>;
}

/** 对齐 A8 bundle `sBe.isLimit/getValue`
 *
 * A8：
 *  - setLimit(value, payoutOdds) 内部存的是 payout = value * payoutOdds
 *  - isLimit(betMoney, odds) => floor(payout/odds) < betMoney （赔率/限红未过期时）
 *
 * changmen 本地限红：
 *  - LimitEntry.value 直接存 value（最大买入/限红金额）
 *  - LimitEntry.payout 存 payoutOdds（A8 传入 h.Odds）
 *  - 因此 payoutStored = value * payoutOdds
 */
function imLocalLimitGetValue(limit: LimitEntry, odds: number): number {
  const oddsNow = Number(odds) || 0;
  const value = Number(limit.value) || 0;
  const payoutOdds = Number(limit.payout ?? 0) || 0;
  if (!oddsNow || !payoutOdds) return value;
  return Math.floor((value * payoutOdds) / oddsNow);
}

function imLocalLimitIsLimit(limit: LimitEntry, betMoney: number, odds: number): boolean {
  const bm = Number(betMoney) || 0;
  const oddsNow = Number(odds) || 0;
  const value = Number(limit.value) || 0;
  const payoutOdds = Number(limit.payout ?? 0) || 0;

  // 过期判定已由 getVenueOddsLimit() 处理；这里按 A8 逻辑容错
  if (limit.expireTime && limit.expireTime < Date.now()) return false;

  // A8：if (!betMoney || !payout) return betMoney > value
  if (!bm || !payoutOdds) return bm > value;

  // A8：else return Math.floor(payout/odds) < betMoney
  // payoutStored = value * payoutOdds
  if (!oddsNow) return bm > value;
  return Math.floor((value * payoutOdds) / oddsNow) < bm;
}

async function extendImSession(account: PlatformAccount): Promise<void> {
  const path = "/api/ExtendSession";
  const payload = await signImPayload(
    {
      BettingChannel: 1,
      Token: account.token,
      TriggeredBy: 2,
    },
    path,
  );
  const url = imAccountUrl(account, path);
  await accountImPost(account, url, payload, buildImAccountHeaders(account));
}

function resolveImGameId(option: BetOption): number {
  if (option.match?.gameId) return option.match.gameId;
  const store = useMatchStore();
  for (const match of store.matchs) {
    for (const bet of match.bets) {
      for (const item of bet.items) {
        if (item.type === "IM" && item.betId === option.betId) {
          return match.gameId;
        }
      }
    }
  }
  return 0;
}

export const imProvider: PlatformProvider = {
  async getBalance(account) {
    if (!account.token) return undefined;
    try {
      const path = "/api/GetMemberBalance";
      const payload = await signImPayload(
        {
          BettingChannel: 1,
          Token: account.token,
          TriggeredBy: 1,
          Type: 1,
        },
        path,
      );
      const res = await accountImPost<ImBalanceResponse>(
        account,
        imAccountUrl(account, path),
        payload,
        buildImAccountHeaders(account),
      );
      const body = res.data;
      if (body.StatusCode !== 0) return undefined;
      await extendImSession(account);
      const row = body.MemberBalances?.[0];
      return {
        currency: row?.Currency || "CNY",
        balance: Number(row?.AvailableBalance) || 0,
      };
    } catch {
      return undefined;
    }
  },

  async checkBet(account, option) {
    const gameId = resolveImGameId(option);
    const sportId = imSportIdForGame(gameId);
    if (!sportId) {
      option.checkError = `未找到游戏ID:${gameId}对应的参数（支持: ${imSupportedGameIds().join(",")}）`;
      return option;
    }

    const localLimit = getVenueOddsLimit(account.provider, option.itemId);
    if (localLimit && imLocalLimitIsLimit(localLimit, option.betMoney, option.odds)) {
      const limitValue = imLocalLimitGetValue(localLimit, option.odds);
      option.checkError = `本地限红金额：${limitValue.toFixed(2)}`;
      // A8 会 updateOdds(0)；本地实现为保持一致性也调用
      option.updateOdds(0);
      return option;
    }

    const path = "/api/GetBetInfoSingleV2";
    const sCode = Number(option.itemId.split(":")[1]);
    const payload = await signImPayload(
      {
        GameCat: 1,
        OddsType: 3,
        Currency: "RMB",
        Token: account.token,
        BettingChannel: 2,
        BetInfos: [
          {
            SportId: sportId,
            MatchNo: option.betId,
            HDP: 0,
            SCode: sCode,
            STId: 1,
            ComboId: 0,
            ComboSelection: null,
          },
        ],
        Language: "chs",
        TriggeredBy: 1,
      },
      path,
    );
    option.request = payload;

    try {
      const res = await accountImPost<ImBetInfoResponse>(
        account,
        imAccountUrl(account, path),
        payload,
        buildImAccountHeaders(account),
      );
      const body = res.data;
      option.response = body;

      if (body.StatusCode !== 0) {
        option.checkError = body.StatusDesc || "预检失败";
        return option;
      }

      const info = body.BetInfos?.[0];
      if (!info) {
        option.checkError = "数据结构错误";
        return option;
      }
      if (info.StatusCode !== 0) {
        option.checkError = info.StatusDesc || "盘口不可用";
        return option;
      }
      if (option.betMoney < (info.MinStake ?? 0) || option.betMoney > (info.MaxStake ?? 0)) {
        // A8：c.setLimit(fy, e.itemId, h.MaxStake, h.Odds)
        // 其中 payoutOdds = h.Odds
        setVenueOddsLimit(
          account.provider,
          option.itemId,
          Number(info.MaxStake ?? 0) || 0,
          Number(info.Odds ?? option.odds) || 0,
        );
        option.checkError = useMessageStore().limitMessage(account, {
          match: option.match?.title,
          bet: option.bet?.getBetName(),
          odds: option.odds,
          betMoney: option.betMoney,
          limit: Number(info.MaxStake ?? 0) || 0,
        });
        return option;
      }

      const liveOdds = Number(info.Odds) || 0;
      if (option.odds < liveOdds || Math.abs(option.odds - liveOdds) <= 0.01) {
        option.newOdds = Math.min(option.odds, liveOdds);
        option.odds = option.newOdds;
        option.updateOdds(option.newOdds);
      } else {
        option.checkError = `赔率下降至 ${liveOdds}`;
        option.updateOdds(liveOdds);
        return option;
      }

      option.data = await signImPayload(
        {
          GameCat: 1,
          CustomerIP: "",
          BettingChannel: 2,
          OddsType: 3,
          Stake: option.betMoney.toString(),
          IsParlay: false,
          Hash: body.Hash,
          ServerTicks: body.ServerTicks,
          BetLists: [
            {
              MatchNo: option.betId,
              SCode: sCode,
              Odds: option.odds,
              HDP: 0,
              STId: 2,
              ComboId: 0,
              ComboSelection: null,
            },
          ],
          Token: account.token,
          Currency: "RMB",
          IsLiveStreamOn: false,
          TriggeredBy: 1,
        },
        "/api/PlaceBetV2",
      );
      return option;
    } finally {
      if (!option.data) option.updateOdds(option.newOdds ?? 0);
    }
  },

  async getOrders(account): Promise<VenueOrder[]> {
    if (!account.token) return [];

    const path = "/api/GetBetStatement";
    const now = new Date();
    const today = formatDateKey(now);
    const yesterdayDate = new Date(now);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = formatDateKey(yesterdayDate);

    const basePayload = {
      Token: account.token,
      BetDateFrom: `${yesterday}T00:00:00+08:00`,
      BetDateTo: `${today}T23:59:59+08:00`,
      SportId: -99,
      Language: "chs",
      GameCat: 1,
    };

    const [p0, p1] = await Promise.all([
      signImPayload({ ...basePayload, SettleStatus: 0 }, path),
      signImPayload({ ...basePayload, SettleStatus: 1 }, path),
    ]);

    const [r0, r1] = await Promise.all([
      accountImPost<ImBetStatementResponse>(
        account,
        imAccountUrl(account, path),
        p0,
        buildImAccountHeaders(account),
      ),
      accountImPost<ImBetStatementResponse>(
        account,
        imAccountUrl(account, path),
        p1,
        buildImAccountHeaders(account),
      ),
    ]);

    const rows: VenueOrder[] = [];
    for (const body of [r0.data, r1.data]) {
      const statements = body?.BetStatements ?? [];
      for (const stmt of statements) {
        const v = stmt.BetDetails?.[0];
        if (!v) continue;

        let status: VenueOrder["status"] = "none";
        let reward = 0;
        let money = 0;

        if (stmt.IsCancelled) {
          status = "reject";
        } else if (stmt.IsSettled) {
          const winLose = Number(stmt.WinLose);
          if (winLose === 1) {
            status = "win";
            reward = Number(stmt.Stake) + Number(stmt.Return);
            money = Number(stmt.Return);
          } else if (winLose === 2) {
            status = "lose";
            money = -Number(stmt.Stake);
          }
        }

        let item = v.SName || "";
        if (item === "{TeamA}") item = v.HTName || "";
        if (item === "{TeamB}") item = v.ATName || "";

        const odds = Number(stmt.Odds) || 0;
        const betMoney = Number(stmt.Stake) || 0;
        const createAt = parseVenueCreateAt(stmt.BetDate);

        rows.push({
          provider: account.provider,
          orderId: String(stmt.BetId ?? ""),
          odds,
          createAt,
          betMoney,
          reward,
          money,
          status,
          game: v.SportName || "",
          match: [v.HTName || "", v.ATName || ""].join(" VS "),
          bet: v.GTName || "",
          item,
        });
      }
    }

    return rows;
  },

  async betting(account, option) {
    const path = "/api/PlaceBetV2";
    let res: { status: number; data: ImPlaceBetResponse };
    try {
      res = await accountImPost<ImPlaceBetResponse>(
        account,
        imAccountUrl(account, path),
        option.data,
        buildImAccountHeaders(account),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return new BetResult(account.provider, false, message, option.data, err);
    }

    const body = res.data;
    const ok = body?.StatusCode === 0;
    if (!ok) option.updateOdds(0);
    const message = ok
      ? `实际赔率:${body.Odds ?? option.odds}`
      : body?.StatusDesc || "下单失败";
    return new BetResult(account.provider, ok, message, option.data, body);
  },
};
