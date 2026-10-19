import type { PlatformId } from "@changmen/api-contract";
import type { ObservationContext } from "@changmen/shared/order_observation";
import type { UserConfig } from "../types/userConfig";
import type { BetSide, ViewBet, ViewBetItem, ViewMatch } from "./match";
import type { PlatformAccount } from "./platformAccount";
import { saveBetOptionLog } from "../bridge/bettingLog";
import { writeVenueOdds } from "../bridge/oddsAccess";

/** 整数 CNY 保持整数；带小数的 PM USDC 等保留 2 位 */
function normalizeOptionStake(value: unknown): number {
  const n = Number(value) || 0;
  const rounded = Math.round(n);
  if (Math.abs(n - rounded) < 1e-6)
    return rounded;
  return Math.round(n * 100) / 100;
}

/** 对齐 A8 bundle `Tp` */
export class BetOption {
  type: PlatformId;
  match?: ViewMatch;
  bet?: ViewBet;
  item?: ViewBetItem;
  target: BetSide;
  matchId: string;
  betId: string;
  itemId: string;
  odds: number;
  newOdds?: number;
  betMoney: number;
  /** [changmen 扩展] 场馆换算前的编排金额（CNY），仅用于诊断展示。 */
  planBetMoney?: number;
  /** [changmen 扩展] Plan CNY → 场馆金额所用汇率与实际比例，仅用于诊断。 */
  stakeExchange?: number;
  stakeRate?: number;
  stakeCurrency?: string;
  /** [changmen 扩展] 诊断关联：本轮套利 Link 与执行阶段。 */
  diagnosticLinkId?: number;
  diagnosticAttempt?: "initial" | "retry" | "makeup";
  /** [changmen 扩展] 仅供旁路事件关联；不参与下注决策。 */
  observation?: ObservationContext;
  betCount = 0;
  config?: UserConfig;
  loseOrder = false;
  /** 套利 finalize 统一 settle：跳过 placeBet 内后台「受理后确认」轮询，防双 settle */
  deferPostAcceptSettlement = false;
  data: Record<string, unknown> | null = null;
  checkError?: string;
  orderIndex = 0;
  request?: unknown;
  response?: unknown;
  startTime: number;

  constructor(
    matchOrType: ViewMatch | PlatformId,
    betOrMatchId: ViewBet | string,
    itemOrBetId: ViewBetItem | string,
    targetOrItemId: BetSide | string,
    betMoneyOrTarget?: number | BetSide,
    targetOrOdds?: BetSide | number,
    oddsArg?: number,
  ) {
    this.startTime = Date.now();
    if (typeof matchOrType === "string") {
      this.type = matchOrType;
      this.matchId = String(betOrMatchId);
      this.betId = String(itemOrBetId);
      this.itemId = String(targetOrItemId);
      this.betMoney = normalizeOptionStake(betMoneyOrTarget);
      this.target = (targetOrOdds as BetSide) || "Home";
      this.odds = Number(oddsArg) || 0;
    }
    else {
      const match = matchOrType;
      const bet = betOrMatchId as ViewBet;
      const item = itemOrBetId as ViewBetItem;
      const target = targetOrItemId as BetSide;
      this.type = item.type;
      this.match = match;
      this.bet = bet;
      this.item = item;
      this.target = target;
      this.matchId = item.matchId;
      this.betId = item.betId;
      this.itemId = item.getItemId(target);
      this.odds = item.getOdds(target);
      this.betMoney = normalizeOptionStake(betMoneyOrTarget);
      // [changmen 扩展] PF：Sources 已带 HomeMarketID 时预填，避免仅靠 fo
      if (item.type === "PredictFun") {
        const marketId = String(
          target === "Home" ? item.homeSubscribeId : item.awaySubscribeId,
        ).trim();
        if (marketId)
          this.data = { marketId };
      }
      // [changmen 扩展] SXBet：BetID = marketHash
      if (item.type === "SXBet" && item.betId) {
        this.data = { ...(this.data ?? {}), marketHash: String(item.betId) };
      }
    }
  }

  /** [A8 可证实] bundle `Ap.updateOdds`：只写 fo/Xn，不改 e.odds / e.newOdds */
  updateOdds(next: number) {
    writeVenueOdds(this.type, {
      id: this.itemId,
      odds: next,
      isLock: false,
      betId: this.betId,
      time: Date.now(),
    });
  }

  /** [A8 可证实] bundle `Ap.saveLog` */
  saveLog(account: PlatformAccount) {
    saveBetOptionLog(this, account);
  }
}

export function opponentSide(side: BetSide): BetSide {
  return side === "Home" ? "Away" : "Home";
}
