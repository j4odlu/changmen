import type { ViewBet, ViewMatch } from "@/models/match";
import type { UserConfig } from "@/types/userConfig";
import { executeArbBet as executeUnified } from "@/stores/betting/autoBet/executeArbBet";

/** [changmen 扩展] 所有套利共享阶段；PM 模式由公共入口冻结并传给单腿。 */
export async function executeArbBet(params: {
  match: ViewMatch;
  bet: ViewBet;
  config: UserConfig;
  setMessage: (message: string) => void;
}): Promise<void> {
  return executeUnified(params);
}
