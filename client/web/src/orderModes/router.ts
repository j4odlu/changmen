import type { ViewBet, ViewMatch } from "@/models/match";
import type { UserConfig } from "@/types/userConfig";
import { executeArbBet as executeFok } from "@/stores/betting/autoBet/executeArbBet";
import { captureArbExecutionSelection } from "@/stores/betting/execution/selection";

/** [changmen 扩展] Select once, before preparation. No state, recovery, or fallback here. */
export async function executeArbBet(params: {
  match: ViewMatch;
  bet: ViewBet;
  config: UserConfig;
  setMessage: (message: string) => void;
}): Promise<void> {
  const selection = captureArbExecutionSelection();
  if (selection.orderMode === "GTC") {
    const { executeGtcAttempt } = await import("./gtc/autoEntry");
    return executeGtcAttempt(params);
  }
  return executeFok(params);
}
