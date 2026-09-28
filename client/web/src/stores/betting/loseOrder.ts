import { BetOption, opponentSide } from "@changmen/client-core/models/betOption";
import { makeUpBetToastSeconds } from "@/shared/betTiming";
import { isPendingConfirmVenueProvider } from "@changmen/shared/account_multiply";
import { useAccountStore } from "@/stores/accountStore";
import { passesMakeUpAccount } from "@/stores/betting/betFilters";
import {
  buildLoseOrderBetLookup,
  resolveLoseOrderBetRef,
} from "@/stores/betting/loseOrderLookup";
import {
  processPmMakeUpLeg,
  schedulePendingVenueMakeUpResume,
} from "@/stores/betting/loseOrderPm";
import { processA8RegularVenueMakeUpLeg } from "@/stores/betting/loseOrderRegular";
import { markSuccessfulBet, readUsedAccounts } from "@/stores/betting/successMarkers";
import { syncActiveBetMakeupAttempt } from "@/stores/betting/activeBetRunSync";
import { useActiveBetRunStore } from "@/stores/activeBetRunStore";
import { useUserStore } from "@/stores/userStore";
import { useLoseOrderStore } from "@/stores/loseOrderStore";
import { useMatchStore } from "@/stores/matchStore";
import { legStakeCny } from "@/domain/polymarket/pmArbStake";
import {
  checkMakeupProfitRateCandidate,
  filterMakeupOddsBandCandidates,
  isMakeupOddsBandEnabled,
  isMakeupProfitRateMode,
} from "@/extensions/arbBet/makeupOddsBand";

export interface LoseOrderTickContext {
  setMessage: (msg: string) => void;
}

function scheduleArbFailAutoSellByLink(
  linkId: number,
  setMessage: (msg: string) => void,
  reason: string,
): void {
  // 关闭时不 import、不调用，补单出队语义与改前一致
  if (useUserStore().extensionPrefs?.arbFailAutoSell?.enabled !== true)
    return;
  void import("@/extensions/arbBet/arbFailAutoSell")
    .then(({ maybeArbFailAutoSellByLink }) => maybeArbFailAutoSellByLink({
      linkId,
      setMessage,
      reason,
    }))
    .catch(() => {});
}

/**
 * [A8 可证实] 补单队列消费（bundle `jb`）
 *
 * 普通场馆：见 `loseOrderRegular.ts`（严格对齐 index0706）。
 * [changmen 扩展] PM：见 `loseOrderPm.ts`（状态层走 adapter `resolvePolymarketLegOutcome`）。 */
export async function processLoseOrders(ctx: LoseOrderTickContext): Promise<void> {
  const user = useUserStore();
  const matchStore = useMatchStore();
  const accountStore = useAccountStore();
  const loseStore = useLoseOrderStore();
  const config = user.config;
  const { setMessage } = ctx;
  const removeIds = new Set<number>();
  /** [changmen 扩展] 未补成出队 → 尝试卖 PM/PF 敞口（仅 prefs 开启） */
  const abandonSellByBetId = new Map<number, { linkId: number; reason: string }>();
  const betLookup = buildLoseOrderBetLookup(matchStore.matchs);
  const failSellOn = user.extensionPrefs?.arbFailAutoSell?.enabled === true;

  for (const [betId, order] of loseStore.orders) {
    const ref = resolveLoseOrderBetRef(order, matchStore.matchs, betLookup);
    const resumed = schedulePendingVenueMakeUpResume({
      betId,
      order,
      match: ref?.match,
      bet: ref?.bet,
      accountStore,
      loseStore,
      removeIds,
      setMessage,
      markSuccess: (account, target) => markSuccessfulBet(account, betId, target),
    });
    if (resumed === "handled")
      continue;
    // PM/PF delayed 状态观察可以在 makeUp 关闭时运行；普通补单 POST 仍严格受 A8 开关门控。
    if (!config.makeUp)
      continue;
    if (!ref) {
      // [A8 可证实] `!ce||!ge` → Z.push(z) 出队（含 link 绑定）
      removeIds.add(betId);
      if (failSellOn && order.linkId) {
        abandonSellByBetId.set(betId, {
          linkId: order.linkId,
          reason: "补单目标已离盘",
        });
      }
      continue;
    }
    const { match, bet } = ref;

    const bandPrefs = user.extensionPrefs?.makeupOddsBand;
    const useBand = isMakeupOddsBandEnabled(bandPrefs) && !order.isCreateOrder;
    const minOdds = order.getOdds(config.makeProfit);
    const banded = useBand && bandPrefs
      ? filterMakeupOddsBandCandidates(
          [...bet.items].sort(
            (a, b) => b.getOdds(order.target) - a.getOdds(order.target),
          ),
          item => item.getOdds(order.target),
          order.betOdds,
          bandPrefs,
          {
            filledStake: order.betMoney,
            getMakeupStake: (_item, odds) => order.getBetMoney(odds),
          },
        )
      : null;
    const candidates = banded ?? bet.items
      .filter(item => item.getOdds(order.target) >= minOdds)
      .sort((a, b) => b.getOdds(order.target) - a.getOdds(order.target));

    for (const item of candidates) {
      if (removeIds.has(betId))
        break;

      // 已有 pending 续查单时，禁止再 POST 新补单（等 tryResume / 下轮 settle）
      if (order.pendingVenueOrderId)
        break;

      const sideOdds = item.getOdds(order.target);
      const stake = order.getBetMoney(sideOdds);

      // [A8 可证实] jb 不调用 B()；makeUp_odds / 初赔天花板仅在入队
      const account = accountStore.getAccount(
        item.type,
        stake,
        config.noSameProvider ? readUsedAccounts(bet.id, opponentSide(order.target)) : [],
        acc => passesMakeUpAccount(acc, sideOdds, bet.id, order.target),
      );
      if (!account)
        continue;

      const option = new BetOption(match, bet, item, order.target, stake);
      option.loseOrder = true;
      option.diagnosticLinkId = order.linkId;
      option.diagnosticAttempt = "makeup";

      const checked = await accountStore.checkBetting(account, option);
      if (!checked.data)
        continue;

      if (useBand && bandPrefs && isMakeupProfitRateMode(bandPrefs)) {
        const checkedOdds = Number(checked.odds) || sideOdds;
        const checkedStakeCny = legStakeCny(
          checked.betMoney,
          checked.type,
          account,
        );
        const rateCheck = checkMakeupProfitRateCandidate(
          order.betMoney,
          order.betOdds,
          checkedStakeCny,
          checkedOdds,
          bandPrefs,
        );
        if (!rateCheck?.allowed)
          continue;
      }

      const waitSec = makeUpBetToastSeconds(config, account.provider);
      const makeupSide = useActiveBetRunStore().runs.get(betId)?.legs
        .find(l => l.target === order.target && l.status !== "skipped")?.side;
      syncActiveBetMakeupAttempt(betId, item.type, `尝试补单 @${sideOdds}`, makeupSide);
      const result = await accountStore.betting(
        account,
        checked,
        waitSec,
        order.linkId ? { linkId: order.linkId } : undefined,
      );

      if (!result?.success) {
        // [A8 可证实] `else le||Z.push(z)`：null/undefined 出队；`{success:false}` 保留
        if (!result) {
          removeIds.add(betId);
          if (failSellOn && order.linkId) {
            abandonSellByBetId.set(betId, {
              linkId: order.linkId,
              reason: "补单请求失败",
            });
          }
        }
        continue;
      }

      if (isPendingConfirmVenueProvider(account.provider)) {
        await processPmMakeUpLeg({
          betId,
          order,
          match,
          bet,
          account,
          checked,
          result,
          platformLabel: item.type,
          loseStore,
          removeIds,
          setMessage,
        });
        break;
      }

      await processA8RegularVenueMakeUpLeg({
        betId,
        order,
        bet,
        account,
        checked,
        result,
        waitSec,
        accountStore,
        removeIds,
        setMessage,
      });
      // [A8 可证实] 拒单不出队时内层 for 继续下一 platform；出队后下轮 removeIds.has 打断
    }
  }

  for (const betId of removeIds) {
    if (loseStore.orders.has(betId))
      loseStore.removeOrder(betId, true);
    const abandon = abandonSellByBetId.get(betId);
    if (abandon)
      scheduleArbFailAutoSellByLink(abandon.linkId, setMessage, abandon.reason);
  }
}
