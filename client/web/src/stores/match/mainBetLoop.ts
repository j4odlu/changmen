import { wait } from "@changmen/client-core/shared/wait";
/**
 * [A8 可证实] 对齐 bundle `Vg` 内 `P()`：单主循环 — 拉列表门控、每轮 updateOdds、当场套利下单、补单、初赔门控。
 * 轮间 `wait(100ms)` 再调度（不用 `betInterval`）。
 */
import { useAccountStore } from "@/stores/accountStore";
import { runArbBetRound } from "@/stores/betting/runArbBetRound";
import { useLoseOrderStore } from "@/stores/loseOrderStore";
import { useMatchStore } from "@/stores/matchStore";
import { useOddsStore } from "@/stores/oddsStore";
import { useUserStore } from "@/stores/userStore";

export const MAIN_LOOP_DELAY_MS = 100;
export const MATCH_POLL_MS = 30_000;
export const LOSE_ORDER_PRUNE_MS = 60_000;
export const DEFAULT_ODDS_MS = 10 * 60 * 1000;

export interface MainBetLoopState {
  lastLoseOrderPruneAt: number;
}

/** 单轮主循环体（不含 finally 调度） */
export async function runMainBetLoopTick(state: MainBetLoopState): Promise<void> {
  const user = useUserStore();
  const matchStore = useMatchStore();
  const loseStore = useLoseOrderStore();
  const oddsStore = useOddsStore();

  matchStore.tickBettingAutoOpen();
  if (!user.userId)
    return;

  const now = Date.now();

  if (now - matchStore.lastFetchAt >= MATCH_POLL_MS) {
    const fetched = await matchStore.fetchMatches(true);
    // [A8 可证实] GetMatchs 失败：整轮 P() 早退（不 clean、不 prune、不套利/补单/初赔）
    if (!fetched)
      return;

    oddsStore.clean();
    if (now - state.lastLoseOrderPruneAt >= LOSE_ORDER_PRUNE_MS) {
      loseStore.ensureOrdersMap();
      loseStore.removeOrders(matchStore.matchs.flatMap(m => m.bets.map(b => b.id)));
      state.lastLoseOrderPruneAt = now;
    }
  }
  else if (matchStore.matchs.length) {
    matchStore.refreshOddsOnBets();
  }

  // [A8 可证实] `if(!t.value)return` 仅对 null/undefined；空数组 [] 仍跑补单与初赔门控
  await runArbBetRound({
    setMessage: m => matchStore.setBettingMessage(m),
    processLoseOrders: () => matchStore.processLoseOrders(),
  });

  // [changmen 扩展] 仅开启时加载扫描；关闭时主循环与改前一致
  if (user.extensionPrefs?.arbEarlyLockSell?.enabled === true) {
    void import("@/extensions/arbBet/arbEarlyLockSell")
      .then(({ runArbEarlyLockSellTick }) => runArbEarlyLockSellTick())
      .catch(() => {});
  }

  // [changmen 扩展] EV 自动下注：不依赖套利开关；每轮最多一笔
  if (user.extensionPrefs?.valueBet?.autoBet?.enabled === true) {
    void import("@/extensions/valueBet/valueBetAutoBet")
      .then(({ runValueBetAutoBetTick }) => runValueBetAutoBetTick())
      .catch(() => {});
  }

  if (now - matchStore.defaultOddsFetchedAt >= DEFAULT_ODDS_MS) {
    await matchStore.fetchMatchDefaultOdds();
  }
}

export async function runMainBetLoopFinally(): Promise<void> {
  const accountStore = useAccountStore();
  for (const acc of accountStore.accounts) {
    if (acc.active)
      acc.active = false;
  }
  await wait(MAIN_LOOP_DELAY_MS);
}
