import type { ObservationContext } from "@changmen/shared/order_observation";
import type { BetSide, ViewBet, ViewMatch } from "@/models/match";
import type { useLoseOrderStore } from "@/stores/loseOrderStore";
import type { UserConfig } from "@/types/userConfig";
import { wait } from "@changmen/client-core/shared/wait";
import { getDefaultOdds } from "@/api/report";
import { isMakeupOddsBandEnabled } from "@/extensions/arbBet/makeupOddsBand";
import { LoseOrder } from "@/models/loseOrder";
import { saveMakeUpQueueLog } from "@/services/bettingLog";
import { createObservationContext, observeOrder } from "@/services/orderObservation";
import { a8Tip } from "@/shared/a8Notify";
import { useUserStore } from "@/stores/userStore";

/**
 * [A8 可证实] 对齐 bundle `B()`：入队前初赔 / 败腿赔率天花板。
 * jb 消费段不调用（index0706 全文件仅 2 处 `await B(`，均在 createOrder 前）。
 * 上下沿开启时 UI 已藏掉这两项，入队也不再套这道天花板，改由消费带过滤。
 */
export async function allowMakeUpForLeg(
  match: ViewMatch,
  bet: ViewBet,
  target: BetSide,
  /** 败腿当时赔率（A8 `B(D)` 的 `D.odds`），不是消费期盘口价 */
  failedLegOdds: number,
  config: UserConfig,
  setMessage: (msg: string) => void,
  opts: { notify?: boolean } = {},
): Promise<boolean> {
  const notify = opts.notify !== false;
  if (isMakeupOddsBandEnabled(useUserStore().extensionPrefs?.makeupOddsBand))
    return true;
  let denyReason: string | undefined;
  if (config.makeUp_defaultOdds !== 0) {
    const def = await getDefaultOdds({
      matchId: match.id,
      betId: bet.id,
      team: target,
    });
    if (def !== 0 && config.makeUp_defaultOdds <= def) {
      denyReason = `初赔赔率:${def}，大于当前设定值：${config.makeUp_defaultOdds}`;
    }
  }
  if (!denyReason && config.makeUp_odds !== 0 && config.makeUp_odds <= failedLegOdds) {
    denyReason = `当前赔率:${failedLegOdds}，大于当前设定值：${config.makeUp_odds}`;
  }
  if (denyReason) {
    if (notify) {
      setMessage(`不予补单：${denyReason}`);
      a8Tip("不予补单提醒", denyReason, 3000);
    }
    return false;
  }
  return true;
}

/** [A8 可证实] 入队：先 `B(败腿)`，通过才 createOrder + tip「补单提醒」 */
export async function enqueueMakeUpOrder(params: {
  observation?: ObservationContext;
  loseStore: ReturnType<typeof useLoseOrderStore>;
  match: ViewMatch;
  bet: ViewBet;
  config: UserConfig;
  setMessage: (msg: string) => void;
  linkId: number;
  accountId: number;
  target: BetSide;
  betMoney: number;
  betOdds: number;
  failedLegOdds: number;
  failedPlatformLabel: string;
}): Promise<boolean> {
  const {
    loseStore,
    match,
    bet,
    config,
    linkId,
    accountId,
    target,
    betMoney,
    betOdds,
    failedLegOdds,
    failedPlatformLabel,
    setMessage,
  } = params;

  // [A8 可证实] createOrder = Map.set：同 betId 直接覆盖；入队前仍过 B()
  const ok = await allowMakeUpForLeg(
    match,
    bet,
    target,
    failedLegOdds,
    config,
    setMessage,
  );
  if (!ok) {
    observeOrder(params.observation, linkId, "decision", { outcome: "blocked", reasonCode: "makeup_entry_gate", target });
    return false;
  }

  loseStore.createOrder(
    new LoseOrder({
      observation: createObservationContext(params.observation, true),
      accountId,
      matchId: match.id,
      betId: bet.id,
      target,
      betMoney,
      betOdds,
      match: match.title,
      bet: bet.getBetName(),
      linkId,
      createAt: Date.now(),
      isCreateOrder: false,
      betCount: 1,
    }),
  );
  saveMakeUpQueueLog({
    linkId,
    target,
    match: match.title,
    bet: bet.getBetName(),
    anchorBetMoney: betMoney,
    anchorOdds: betOdds,
    failedLegOdds,
    failedPlatformLabel,
  });
  await wait(500);
  setMessage(`${failedPlatformLabel} 下单失败，已加入补单队列`);
  a8Tip("补单提醒", `${failedPlatformLabel} 下单失败，创建补单队列`, 3000);
  return true;
}
