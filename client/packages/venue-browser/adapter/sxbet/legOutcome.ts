/**
 * SX Bet 订单状态层：fill 受理后 PENDING → SUCCESS / FAILED（链上确认）
 * @see https://docs.sx.bet/developers/filling-orders
 */

import type { BetResult } from "@changmen/client-core/models/betResult";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import type {
  ResolveLegOutcomeOpts,
  VenueLegOutcome,
  VenueLegSettlement,
  VenueOrder,
} from "../contract";
import { sortVenueOrdersNewestFirst } from "../contract";
import { venueRejectWaitBeforePoll } from "../shared/rejectWait";
import { PLATFORMS } from "../shared/platforms";
import { fetchSxTrades } from "./api";
import {
  parseSxBetTokenConfig,
  resolveSxBetPrivateKey,
} from "./credentials";
import {
  checksumSxAddress,
  parseSxTradeNetReturnUsdc,
  parseSxTradeStakeUsdc,
  walletFromSxPrivateKey,
} from "./orders";
import { sxProtocolOddsToDecimal } from "./parse";

const PLATFORM = PLATFORMS.SXBet;
const DEFAULT_POLL_ATTEMPTS = 10;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function pollIntervalMs(attemptIndex: number): number {
  if (attemptIndex < 3)
    return 400;
  if (attemptIndex < 6)
    return 800;
  return 1200;
}

function rejectVenueOrder(
  account: PlatformAccount,
  result: BetResult,
  settlement: Exclude<VenueLegSettlement, "filled">,
): VenueOrder {
  const check = result.request as {
    stakeUsdc?: number;
    odds?: number;
    marketHash?: string;
  } | null | undefined;
  return {
    provider: account.provider ?? PLATFORM,
    orderId: String(result.orderId ?? "").trim() || `sx-reject-${Date.now()}`,
    odds: Number(check?.odds) || 0,
    createAt: Number(result.beginTime) || Date.now(),
    betMoney: Number(check?.stakeUsdc) || 0,
    reward: 0,
    money: 0,
    status: settlement === "unfilled" ? "reject" : "pending",
    game: "",
    match: String(check?.marketHash ?? ""),
    bet: "SXBet",
    item: "",
  };
}

function tradeStatusToSettlement(status: string | undefined): VenueLegSettlement | null {
  const raw = String(status ?? "").toUpperCase();
  if (raw === "SUCCESS" || raw === "SETTLED")
    return "filled";
  if (raw === "FAILED" || raw === "CANCELLED" || raw === "CANCELED")
    return "unfilled";
  if (raw === "PENDING" || raw === "SUBMITTED")
    return "timeout";
  return null;
}

export async function resolveSxBetProviderLegOutcome(
  account: PlatformAccount,
  result?: BetResult,
  opts?: ResolveLegOutcomeOpts,
): Promise<VenueLegOutcome> {
  if (!result) {
    return {
      orders: opts?.orders ? sortVenueOrdersNewestFirst(opts.orders) : [],
      settlement: "unfilled",
    };
  }

  const orderId = String(result.orderId ?? "").trim();
  if (!result.success || !orderId) {
    return {
      orders: opts?.orders ? sortVenueOrdersNewestFirst(opts.orders) : [],
      settlement: "unfilled",
    };
  }

  await venueRejectWaitBeforePoll(opts?.rejectWaitSec);

  const privateKey = resolveSxBetPrivateKey(parseSxBetTokenConfig(account.token));
  if (!privateKey) {
    return {
      orders: [rejectVenueOrder(account, result, "timeout")],
      settlement: "timeout",
    };
  }

  const bettor = checksumSxAddress(walletFromSxPrivateKey(privateKey).address);
  let lastSettlement: VenueLegSettlement = "timeout";

  for (let i = 0; i < DEFAULT_POLL_ATTEMPTS; i += 1) {
    try {
      const trades = await fetchSxTrades({ bettor, pageSize: 30 });
      const hit = trades.find(row => {
        const id = orderId;
        return String(row.fillHash ?? "").trim() === id
          || String(row.fillOrderHash ?? "").trim() === id
          || String(row.tradeHash ?? "").trim() === id;
      });
      if (hit) {
        const settlement = tradeStatusToSettlement(hit.tradeStatus) ?? "timeout";
        lastSettlement = settlement;
        if (settlement === "filled") {
          const orders = opts?.fetchVenueOrders
            ? await opts.fetchVenueOrders()
            : (opts?.orders ?? []).concat([{
              provider: account.provider ?? PLATFORM,
              orderId,
              odds: sxProtocolOddsToDecimal(hit.odds ?? hit.percentageOdds) || 0,
              createAt: Number(result.beginTime) || Date.now(),
              betMoney: parseSxTradeStakeUsdc(hit),
              reward: parseSxTradeNetReturnUsdc(hit.netReturn),
              money: 0,
              status: "none",
              game: String(hit.leagueLabel ?? ""),
              match: [hit.teamOneName, hit.teamTwoName].filter(Boolean).join(" vs "),
              bet: "全场胜负",
              item: "",
            }]);
          return {
            orders: sortVenueOrdersNewestFirst(orders),
            settlement: "filled",
          };
        }
        if (settlement === "unfilled") {
          return {
            orders: [rejectVenueOrder(account, result, "unfilled")],
            settlement: "unfilled",
          };
        }
      }
    }
    catch (err) {
      console.warn("[SXBet] resolveLegOutcome poll error", err);
    }
    if (i < DEFAULT_POLL_ATTEMPTS - 1)
      await sleep(pollIntervalMs(i));
  }

  return {
    orders: [rejectVenueOrder(account, result, lastSettlement === "unfilled" ? "unfilled" : "timeout")],
    settlement: lastSettlement === "unfilled" ? "unfilled" : "timeout",
  };
}
