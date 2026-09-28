import { accountsFundingReady } from "@/stores/account/accountPicker";
import { useAccountStore } from "@/stores/accountStore";
import { runA8ArbRound } from "@/stores/betting/a8/runA8ArbRound";
import { peekPendingOrderBinds, processPendingOrderBinds } from "@/stores/betting/pendingOrderBind";
import { useUserStore } from "@/stores/userStore";
import { useLoseOrderStore } from "@/stores/loseOrderStore";

export interface ArbBetRoundContext {
  setMessage: (msg: string) => void;
  processLoseOrders: () => Promise<void>;
}

/** 主循环单轮：按执行模式调度套利 + 补单 */
export async function runArbBetRound(ctx: ArbBetRoundContext): Promise<void> {
  const user = useUserStore();
  const loseStore = useLoseOrderStore();
  const { setMessage, processLoseOrders } = ctx;

  const config = user.config;
  const hasPending = peekPendingOrderBinds().length > 0;
  const hasPendingVenueObservation = [...loseStore.orders.values()]
    .some(order => Boolean(order.pendingVenueOrderId));
  const needMakeUp = Boolean(config.makeUp && loseStore.orders.size);
  const needLoseOrderWork = needMakeUp || hasPendingVenueObservation;
  const needBetting = Boolean(config.betting && accountsFundingReady(useAccountStore()));

  if (!hasPending && !needLoseOrderWork && !needBetting)
    return;

  // [changmen 扩展] 上一轮 Bind 失败的补绑（不依赖 betting 开关）
  if (hasPending)
    await processPendingOrderBinds();

  // [A8 可证实] 资金未就绪只跳过套利轮；补单在 makeUp 开启时仍消费队列
  if (needBetting)
    await runA8ArbRound({ setMessage });

  // [changmen 扩展] delayed 原单观察不受补单开关控制；processLoseOrders 内仍禁止关闭时 POST 新单。
  if (needLoseOrderWork)
    await processLoseOrders();
}
