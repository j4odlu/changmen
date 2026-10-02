import type { BetResult } from "@changmen/client-core/models/betResult";
import type { ViewBet, ViewBetItem, ViewMatch } from "@/models/match";
import type { PlatformAccount } from "@/models/platformAccount";
import type { ArbExecutionTrace } from "@/stores/betting/autoBet/arbExecutionTrace";
import type { PlatformId } from "@/types/esport";
import type { UserConfig } from "@/types/userConfig";
import { BetOption, opponentSide } from "@changmen/client-core/models/betOption";
import { isPendingConfirmVenueProvider } from "@changmen/shared/account_multiply";
import { isSingleLegRateAtOdds } from "@/domain/betting/singleLegRate";
import { hedgeStakeCnyFromLeg, legStakeCny } from "@/domain/polymarket/pmArbStake";
import {
  checkMakeupProfitRateCandidate,
  filterMakeupOddsBandCandidates,
  isMakeupOddsBandEnabled,
  isMakeupProfitRateMode,
} from "@/extensions/arbBet/makeupOddsBand";
import { createObservationContext, observeOption } from "@/services/orderObservation";
import { useAccountStore } from "@/stores/accountStore";
import { readUsedAccounts } from "@/stores/betting/successMarkers";
import { useMatchStore } from "@/stores/matchStore";
import { useUserStore } from "@/stores/userStore";

/**
 * 对齐 bundle：一侧成功、一侧失败时换平台重试失败腿（最多 3 轮）。
 * anyOdds 仅影响最低赔阈值（makeProfit vs anyOddsProfit）。
 * `makeupOddsBand` 开启时替代该地板（与补单消费同一扇门）；关闭时本函数与改前一致。
 * 选账号 filter 与 bundle 主循环 anyOdds 段一致：pause / 已试平台 / minOdds / betTarget。
 */
export async function retryFailedLeg(
  match: ViewMatch,
  bet: ViewBet,
  successLeg: BetOption,
  failedLeg: BetOption,
  successAccount: PlatformAccount | undefined,
  config: UserConfig,
  waitSec: number,
  trace?: ArbExecutionTrace,
  linkId?: number,
): Promise<{ leg: BetOption; account: PlatformAccount; result: BetResult } | null> {
  const accountStore = useAccountStore();
  const matchStore = useMatchStore();
  const bandPrefs = useUserStore().extensionPrefs?.makeupOddsBand;
  // 关上下沿、或关掉「是否补单」：即时重试仍走 A8 makeProfit / anyOddsProfit
  const useBand = isMakeupOddsBandEnabled(bandPrefs) && config.makeUp !== false;
  const profitThreshold = config.anyOdds ? config.anyOddsProfit : config.makeProfit;
  const minOdds = 1 / (1 / profitThreshold - 1 / successLeg.odds);
  const successStakeCny = legStakeCny(
    successLeg.betMoney,
    successLeg.type,
    successAccount,
  );

  const tried: PlatformId[] = [];

  for (let round = 0; round < 3; round++) {
    bet.items.forEach(item => item.updateOdds());

    const banded = useBand && bandPrefs
      ? filterMakeupOddsBandCandidates(
          bet.items
            .filter(item => !tried.includes(item.type))
            .sort(
              (a, b) => b.getOdds(failedLeg.target) - a.getOdds(failedLeg.target),
            ),
          item => item.getOdds(failedLeg.target),
          successLeg.odds,
          bandPrefs,
          {
            filledStake: successStakeCny,
            getMakeupStake: (_item, odds) => hedgeStakeCnyFromLeg(
              successLeg.odds,
              successLeg.betMoney,
              successLeg.type,
              odds,
              successAccount,
            ),
          },
        )
      : null;
    const candidates = banded ?? bet.items
      .filter(
        item =>
          !tried.includes(item.type)
          && item.getOdds(failedLeg.target) >= minOdds,
      )
      .sort(
        (a, b) => b.getOdds(failedLeg.target) - a.getOdds(failedLeg.target),
      );

    if (!candidates.length) {
      // 带内空仓（含 []）：继续后续轮 updateOdds；公式无解 null 已回退旧地板，仍空则早退
      if (banded !== null)
        continue;
      break;
    }

    let pickedAccount: PlatformAccount | undefined;
    let pickedItem: ViewBetItem | undefined;
    let stake = 0;

    for (const item of candidates) {
      const odds = item.getOdds(failedLeg.target);
      stake = hedgeStakeCnyFromLeg(
        successLeg.odds,
        successLeg.betMoney,
        successLeg.type,
        odds,
        successAccount,
      );
      const acc = accountStore.getAccount(
        item.type,
        stake,
        config.noSameBet
          ? readUsedAccounts(bet.id, opponentSide(failedLeg.target))
          : [],
        (u) => {
          if (u.isPause() || tried.includes(u.provider))
            return false;
          if (isSingleLegRateAtOdds(u, odds))
            return false;
          if (u.getMinOdds() > odds)
            return false;
          const target = matchStore.getBetTarget(u.provider, bet.id);
          if (target && target !== failedLeg.target)
            return false;
          return true;
        },
      );
      if (acc) {
        pickedAccount = acc;
        pickedItem = item;
        break;
      }
    }

    if (!pickedAccount || !pickedItem)
      break;

    tried.push(pickedAccount.provider);
    let retryLeg = new BetOption(match, bet, pickedItem, failedLeg.target, stake);
    retryLeg.odds = pickedItem.getOdds(failedLeg.target);
    retryLeg.diagnosticLinkId = linkId;
    retryLeg.diagnosticAttempt = "retry";
    retryLeg.observation = createObservationContext({ ownerUserId: failedLeg.observation?.ownerUserId, anchorAttemptId: successLeg.observation?.attemptId });
    observeOption(retryLeg, pickedAccount, "decision", { outcome: "retry_selected", reasonCode: "failed_leg_retry" });
    if (isPendingConfirmVenueProvider(pickedAccount.provider))
      retryLeg.deferPostAcceptSettlement = true;
    trace?.event("重试", `第 ${round + 1} 轮 ${pickedAccount.provider}@${retryLeg.odds}`);
    retryLeg = await accountStore.checkBetting(pickedAccount, retryLeg);
    if (!retryLeg.data)
      continue;

    const guardedOdds = Number(retryLeg.odds) || pickedItem.getOdds(failedLeg.target);
    const retryStakeCny = legStakeCny(
      retryLeg.betMoney,
      retryLeg.type,
      pickedAccount,
    );
    const totalStakeCny = successStakeCny + retryStakeCny;
    const minPayoutCny = Math.min(
      successStakeCny * successLeg.odds,
      retryStakeCny * guardedOdds,
    );
    const guardedProfit = totalStakeCny > 0 ? minPayoutCny / totalStakeCny : 0;
    const minGuardProfit = Number(profitThreshold) || 0;
    if (useBand && bandPrefs && isMakeupProfitRateMode(bandPrefs)) {
      const rateCheck = checkMakeupProfitRateCandidate(
        successStakeCny,
        successLeg.odds,
        retryStakeCny,
        guardedOdds,
        bandPrefs,
      );
      if (!rateCheck?.allowed) {
        observeOption(retryLeg, pickedAccount, "decision", { outcome: "blocked", reasonCode: "makeup_profit_band" });
        trace?.event(
          "重试",
          `拦截 ${pickedAccount.provider}@${guardedOdds}，总体利润率 ${rateCheck ? `${(rateCheck.rate * 100).toFixed(2)}%` : "无法计算"} 位于不补区间`,
        );
        continue;
      }
    }
    else if (!Number.isFinite(guardedProfit) || guardedProfit < minGuardProfit) {
      observeOption(retryLeg, pickedAccount, "decision", { outcome: "blocked", reasonCode: "minimum_profit" });
      trace?.event(
        "重试",
        `拦截 ${pickedAccount.provider}@${guardedOdds}，组合收益 ${guardedProfit.toFixed(4)} < ${minGuardProfit}`,
      );
      continue;
    }

    const result = await accountStore.betting(
      pickedAccount,
      retryLeg,
      waitSec,
      linkId ? { linkId } : undefined,
    );
    if (result?.success) {
      return { leg: retryLeg, account: pickedAccount, result };
    }
  }

  return null;
}
