import type { BetOption } from "@changmen/client-core/models/betOption";
import type { PlatformAccount } from "@/models/platformAccount";
import type { CheckBettingOpts } from "@/stores/account/betGateway";
import { useAccountStore } from "@/stores/accountStore";
import { capturePmManualGtcLimitQuote } from "@/services/polymarketQuotes";

export type GtcCheckOptions = CheckBettingOpts & { manual?: boolean };

/** [changmen 扩展] 旧入口只传 PM 模式参数；钱包、金额换算和预检记录均共用公共账号逻辑。 */
export function checkBetting(account: PlatformAccount | undefined, option: BetOption, opts?: GtcCheckOptions): Promise<BetOption> {
  const { manual, ...shared } = opts ?? {};
  if (account?.provider === "Polymarket" && manual === true)
    capturePmManualGtcLimitQuote(option);
  return useAccountStore().checkBetting(account, option, {
    ...shared,
    ...(account?.provider === "Polymarket" ? { pmOrderMode: "GTC", pmGtcAllowResting: manual === true } : {}),
  });
}
