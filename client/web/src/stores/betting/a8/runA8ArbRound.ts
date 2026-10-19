import { executeArbBet } from "@/orderModes/router";
import { useUserStore } from "@/stores/userStore";
import { useMatchStore } from "@/stores/matchStore";
import { isRayMatchRiskClosed } from "@changmen/venue-adapter/ray";

export interface A8ArbRoundContext {
  setMessage: (msg: string) => void;
}

/** [A8 可证实] 主循环单轮套利段：遍历全部盘口 → executeArbBet */
export async function runA8ArbRound(ctx: A8ArbRoundContext): Promise<void> {
  const user = useUserStore();
  const matchStore = useMatchStore();
  const config = user.config;
  const { setMessage } = ctx;

  if (!config.betting)
    return;

  for (const match of matchStore.matchs) {
    if (isRayMatchRiskClosed(match)) continue;
    for (const bet of match.bets) {
      await executeArbBet({ match, bet, config, setMessage });
    }
  }
}
