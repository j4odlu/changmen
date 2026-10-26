import type { ViewBet, ViewMatch } from "@/models/match";
import type { UserConfig } from "@/types/userConfig";
import { executeArbBet as executeUnified } from "@/stores/betting/autoBet/executeArbBet";

/** [changmen 扩展] 自动套利统一使用现有链路；PM 自动套利仅支持 FOK。 */
export async function executeArbBet(params: {
  match: ViewMatch;
  bet: ViewBet;
  config: UserConfig;
  setMessage: (message: string) => void;
}): Promise<void> {
  return executeUnified(params);
}
