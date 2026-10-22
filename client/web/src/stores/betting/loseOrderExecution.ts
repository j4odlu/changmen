import type { BetSide } from "@/models/match";
import type { useAccountStore } from "@/stores/accountStore";
import type { syncActiveBetMakeupAttempt } from "@/stores/betting/activeBetRunSync";
import type { passesMakeUpAccount } from "@/stores/betting/betFilters";
import type { useLoseOrderStore } from "@/stores/loseOrderStore";
import type { useMatchStore } from "@/stores/matchStore";
import type { useUserStore } from "@/stores/userStore";
import { BetOption, opponentSide } from "@changmen/client-core/models/betOption";
import { completeAcceptedMakeUpLeg } from "@/stores/betting/makeUpAccepted";
import { passesMakeUpPrecheck } from "@/stores/betting/makeUpPrecheck";
import { selectMakeUpCandidates } from "@/stores/betting/makeUpCandidates";
import { createObservationContext } from "@/services/orderObservation";
import { makeUpBetToastSeconds } from "@/shared/betTiming";
import {
  buildLoseOrderBetLookup,
  resolveLoseOrderBetRef,
} from "@/stores/betting/loseOrderLookup";
import { schedulePendingVenueMakeUpResume } from "@/stores/betting/loseOrderPm";
import { markSuccessfulBet, readUsedAccounts } from "@/stores/betting/successMarkers";
import { consumeMakeUpQueue } from "@/stores/loseOrderStore";

export interface LoseOrderTickContext {
  setMessage: (msg: string) => void;
}

/** [changmen 扩展] 本轮执行使用原 store 实例；进度及放弃后的减仓仍在原调用点读取。 */
export interface LoseOrderExecutionDependencies {
  user: Pick<ReturnType<typeof useUserStore>, "config" | "extensionPrefs">;
  matchStore: Pick<ReturnType<typeof useMatchStore>, "matchs">;
  accountStore: ReturnType<typeof useAccountStore>;
  loseStore: ReturnType<typeof useLoseOrderStore>;
  getMakeupSide: (betId: number, target: BetSide) => "A" | "B" | undefined;
  passesMakeUpAccount: typeof passesMakeUpAccount;
  syncActiveBetMakeupAttempt: typeof syncActiveBetMakeupAttempt;
  scheduleArbFailAutoSellByLink: (linkId: number, setMessage: (msg: string) => void, reason: string) => void;
}

/** [changmen 扩展] 原队列消费体，显式接收状态与边界回调；不改变候选、提交、确认或出队规则。 */
export async function runLoseOrderExecution(ctx: LoseOrderTickContext, deps: LoseOrderExecutionDependencies): Promise<void> {
  const {
    user, matchStore, accountStore, loseStore, getMakeupSide,
    passesMakeUpAccount, syncActiveBetMakeupAttempt, scheduleArbFailAutoSellByLink,
  } = deps;
  const config = user.config;
  const { setMessage } = ctx;
  const removeIds = new Set<number>();
  /** [changmen 扩展] 未补成出队 → 尝试卖 PM/PF 敞口（仅 prefs 开启） */
  const abandonSellByBetId = new Map<number, { linkId: number; reason: string }>();
  const betLookup = buildLoseOrderBetLookup(matchStore.matchs);
  const failSellOn = user.extensionPrefs?.arbFailAutoSell?.enabled === true;
  const orders = new Map(loseStore.orders);

  for (const [betId, order] of orders) {
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
      const consumed = consumeMakeUpQueue(loseStore, order, removeIds);
      if (consumed && failSellOn && order.linkId) {
        abandonSellByBetId.set(betId, {
          linkId: order.linkId,
          reason: "补单目标已离盘",
        });
      }
      continue;
    }
    const { match, bet } = ref;

    const bandPrefs = user.extensionPrefs?.makeupOddsBand;
    const { useBand, candidates } = selectMakeUpCandidates({ order, bet, config, bandPrefs });

    for (const item of candidates) {
      if (removeIds.has(betId) || loseStore.orders.get(betId) !== order)
        break;

      // 已有 pending 续查单时，禁止再 POST 新补单（等 tryResume / 下轮 settle）
      if (order.pendingVenueOrderId || order.pendingRegularReceipt)
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
      option.observation = createObservationContext(order.observation);

      const checked = await accountStore.checkBetting(account, option);
      if (loseStore.orders.get(betId) !== order)
        break;
      if (!checked.data)
        continue;

      if (!passesMakeUpPrecheck({ order, checked, account, sideOdds, useBand, bandPrefs }))
        continue;

      const waitSec = makeUpBetToastSeconds(config, account.provider);
      const makeupSide = getMakeupSide(betId, order.target);
      syncActiveBetMakeupAttempt(betId, item.type, `尝试补单 @${sideOdds}`, makeupSide);
      const result = await accountStore.betting(
        account,
        checked,
        waitSec,
        order.linkId ? { linkId: order.linkId } : undefined,
      );
      const isCurrentOrder = loseStore.orders.get(betId) === order;
      // [changmen 扩展] 取消只停止后续下注；任何场馆已受理的原单都必须完成检测、绑定和计数。
      if (!isCurrentOrder && !result?.success)
        break;

      if (!result?.success) {
        // [A8 可证实] `else le||Z.push(z)`：null/undefined 出队；`{success:false}` 保留
        if (!result) {
          const consumed = consumeMakeUpQueue(loseStore, order, removeIds);
          if (consumed && failSellOn && order.linkId) {
            abandonSellByBetId.set(betId, {
              linkId: order.linkId,
              reason: "补单请求失败",
            });
          }
        }
        continue;
      }

      await completeAcceptedMakeUpLeg({
        betId, order, match, bet, item, account, checked, result, isCurrentOrder,
        waitSec, accountStore, loseStore, removeIds, setMessage,
      });
      // [A8 可证实] 拒单不出队时内层 for 继续下一 platform；出队后下轮 removeIds.has 打断
    }
  }

  // [changmen 扩展] 单笔已即时消费；这里只调度明确放弃补单的原 Link 减仓。
  for (const abandon of abandonSellByBetId.values())
    scheduleArbFailAutoSellByLink(abandon.linkId, setMessage, abandon.reason);
}
