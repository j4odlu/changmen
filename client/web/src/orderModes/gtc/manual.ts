import type { BetOption } from "@changmen/client-core/models/betOption";
import type { ViewBet, ViewMatch } from "@/models/match";
import type { PlatformAccount } from "@/models/platformAccount";
import type { GtcOrderRecord } from "./core/orderRecord";
import { BetResult } from "@changmen/client-core/models/betResult";
import { getExchange, resolveAccountCurrency } from "@changmen/shared/currency";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/api/client";
import { useUserStore } from "@/stores/userStore";
import { checkBetting } from "./gateway";
import { startNativeGtcOrders } from "./orderRuntime";
import { prepareGtcOrder, submitGtcOrder } from "./orders";
import { notifyBet } from "@/shared/betNotification";
import { nativeGtcNotice } from "./orderPresentation";
import { lookupPolymarketOrderBetLabel } from "@changmen/venue-browser/adapter/polymarket/orders";

/** [changmen 扩展] 单次手动 GTC，不依赖自动下注开关、不触发另一腿或旧 FOK 编排。 */
export async function executeManualGtc(account: PlatformAccount, input: BetOption, context: {
  match: ViewMatch;
  bet: ViewBet;
}): Promise<GtcOrderRecord> {
  const user = useUserStore(); const owner = String(user.userId);
  const session = getAuthSessionVersion();
  if (!user.isLoggedIn || !user.userId || account.provider !== "Polymarket" || input.type !== "Polymarket")
    throw new Error("请登录后使用 PM 手动 GTC");
  const checkSession = () => {
    if (!isAuthSessionCurrent(session) || String(user.userId) !== owner)
      throw new Error("用户会话已变更，禁止继续发送手动 GTC");
  };
  // 仅保存持续恢复标记；不设置自动套利的 GTC 选择或激活凭据。
  if (!user.extensionPrefs.pmGtcV1Participant) {
    user.extensionPrefs.pmGtcV1Participant = true;
    await user.saveExtensionPrefs();
  }
  checkSession(); startNativeGtcOrders(owner); checkSession();
  // [changmen 扩展] 每次人工下单是独立订单；历史执行或现有挂单不限制新手动单。
  const option = await checkBetting(account, input, { skipAccountRate: true, manual: true });
  checkSession();
  if (!option.data || option.checkError)
    throw new Error(option.checkError || "PM 手动 GTC 预检未通过，未发送订单");
  return notifyBet(account, option, async () => {
    const prepared = await prepareGtcOrder(account, option);
    checkSession();
    const fx = getExchange(resolveAccountCurrency(account.provider, account.currency));
    if (option.stakeExchange != null && option.stakeExchange !== fx)
      throw new Error("PM 手动 GTC 金额币种不一致，未发送订单");
    const linkId = -Date.now();
    const order = await submitGtcOrder(account, prepared, {
      linkId,
      match: context.match.title, bet: lookupPolymarketOrderBetLabel(option.betId, option.itemId) || "盘口待核实",
      item: option.target === "Home" ? context.bet.homeName : context.bet.awayName,
    }, (ack, submittedAt) => {
      const accepted = ack.success === true && Boolean(ack.orderID);
      const result = new BetResult("Polymarket", accepted, accepted ? "手动 GTC 已受理，成交继续核对" : "手动 GTC 未确认受理", { orderType: "GTC", source: "manual" }, ack);
      result.orderId = ack.orderID ?? null; result.link = linkId; result.pending = accepted;
      result.saveLog(account, submittedAt);
    });
    return order;
  }, nativeGtcNotice, 10, { matchTitle: context.match.title, betName: context.bet.getBetName() });
}
