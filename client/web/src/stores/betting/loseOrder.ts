import type { LoseOrderTickContext } from "@/stores/betting/loseOrderExecution";
import { useAccountStore } from "@/stores/accountStore";
import { useActiveBetRunStore } from "@/stores/activeBetRunStore";
import { syncActiveBetMakeupAttempt } from "@/stores/betting/activeBetRunSync";
import { passesMakeUpAccount } from "@/stores/betting/betFilters";
import { runLoseOrderExecution } from "@/stores/betting/loseOrderExecution";
import { useLoseOrderStore } from "@/stores/loseOrderStore";
import { useMatchStore } from "@/stores/matchStore";
import { useUserStore } from "@/stores/userStore";

export type { LoseOrderTickContext } from "@/stores/betting/loseOrderExecution";

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
 * [changmen 扩展] PM：见 `loseOrderPm.ts`（状态层走 adapter `resolvePolymarketLegOutcome`）。
 */
export async function processLoseOrders(ctx: LoseOrderTickContext): Promise<void> {
  const user = useUserStore();
  const matchStore = useMatchStore();
  const accountStore = useAccountStore();
  const loseStore = useLoseOrderStore();
  return runLoseOrderExecution(ctx, {
    user,
    matchStore,
    accountStore,
    loseStore,
    getMakeupSide: (betId, target) => useActiveBetRunStore().runs.get(betId)?.legs.find(l => l.target === target && l.status !== "skipped")?.side,
    passesMakeUpAccount,
    syncActiveBetMakeupAttempt,
    scheduleArbFailAutoSellByLink,
  });
}
