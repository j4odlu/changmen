import type { BetOption } from "@changmen/client-core/models/betOption";
import type { BetResult } from "@changmen/client-core/models/betResult";
import type { PlatformAccount } from "@/models/platformAccount";
import type { CheckBettingOpts } from "@/stores/account/betGateway";
import { getProvider } from "@/runtime/providers";
import { useAccountStore } from "@/stores/accountStore";

export type GtcCheckOptions = CheckBettingOpts & { manual?: boolean };

/** [changmen 扩展] GTC 对侧沿公共账号下单入口；原单授权和重试决定仍归公共套利阶段。 */
export async function placeOtherLeg(account: PlatformAccount, option: BetOption, linkId: number, toastSeconds = 10): Promise<BetResult> {
  return prepareOtherLeg(account, option, linkId, toastSeconds)();
}

/** [changmen 扩展] 预检阶段确认发送能力，发送时共用普通场馆的通知、观察、日志和成功事件。 */
export function prepareOtherLeg(account: PlatformAccount, option: BetOption, linkId: number, toastSeconds = 10): () => Promise<BetResult> {
  if (account.provider === "Polymarket" || !option.data || option.checkError)
    throw new Error("GTC 对侧缺少冻结预检，未发送订单");
  if (!getProvider(account))
    throw new Error("GTC 对侧平台不支持");
  const accounts = useAccountStore();
  return () => {
    // 原单确认仍由首次公共 settle 和独立监控承担，不另起受理后的确认任务。
    option.deferPostAcceptSettlement = true;
    return accounts.betting(account, option, toastSeconds, { linkId, requirePreparedQuote: true });
  };
}

/** [changmen 扩展] 旧入口只传 PM 模式参数；钱包、金额换算和预检记录均共用公共账号逻辑。 */
export function checkBetting(account: PlatformAccount | undefined, option: BetOption, opts?: GtcCheckOptions): Promise<BetOption> {
  const { manual, ...shared } = opts ?? {};
  return useAccountStore().checkBetting(account, option, {
    ...shared,
    ...(account?.provider === "Polymarket" ? { pmOrderMode: "GTC", pmGtcAllowResting: manual === true } : {}),
  });
}
