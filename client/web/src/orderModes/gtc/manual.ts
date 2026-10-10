import type { BetOption } from "@changmen/client-core/models/betOption";
import type { GtcPlan } from "@changmen/shared/pm_gtc";
import type { ViewBet, ViewMatch } from "@/models/match";
import type { PlatformAccount } from "@/models/platformAccount";
import type { GtcExecutionResult } from "@/orderModes/gtc/executionResult";
import { BetResult } from "@changmen/client-core/models/betResult";
import { getExchange, resolveAccountCurrency } from "@changmen/shared/currency";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/api/client";
import { useUserStore } from "@/stores/userStore";
import { createGtc } from "./api";
import { checkBetting } from "./gateway";
import { gtcExecutionResult } from "./result";
import { acceptGtc, currentGtc, gtcProgress, mutateGtc, pollGtc, refreshGtcRecords, startGtcRuntime } from "./runtime";

/** [changmen 扩展] 单次手动 GTC，不依赖自动下注开关、不触发另一腿或旧 FOK 编排。 */
export async function executeManualGtc(account: PlatformAccount, input: BetOption, context: {
  match: ViewMatch;
  bet: ViewBet;
}): Promise<GtcExecutionResult> {
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
  checkSession(); startGtcRuntime(owner); await refreshGtcRecords(); checkSession();
  if (!gtcProgress.ready)
    throw new Error("GTC 订单协调未就绪，未发送订单");
  const { pmSubmitMaker, prepareManualGtcBuy } = await import("@changmen/venue-adapter/polymarket/gtc");
  const maker = pmSubmitMaker(account);
  // [changmen 扩展] 每次人工下单是独立订单；历史执行或现有挂单不限制新手动单。
  const option = await checkBetting(account, input, { skipAccountRate: true, manual: true });
  checkSession();
  if (!option.data || option.checkError)
    throw new Error(option.checkError || "PM 手动 GTC 预检未通过，未发送订单");
  const prepared = await prepareManualGtcBuy(account, option);
  checkSession();
  const fx = getExchange(resolveAccountCurrency(account.provider, account.currency));
  if (option.stakeExchange != null && option.stakeExchange !== fx)
    throw new Error("PM 手动 GTC 金额币种不一致，未发送订单");
  const { submit, validate, ...frozen } = prepared;
  const plan: GtcPlan = { ...frozen, source: "manual", playerId: Number(account.accountId), otherPlayerId: 0, originalPmLeg: "A", otherProvider: "", otherTarget: option.target === "Home" ? "Away" : "Home", otherOdds: 0, otherStake: 0, otherVenueMatchId: "", otherVenueItemId: "", parallel: false, matchId: context.match.id, betRowId: context.bet.id, linkId: -Date.now(), tokenId: option.itemId, conditionId: option.betId, target: option.target, match: context.match.title, bet: context.bet.getBetName(), item: option.target === "Home" ? context.bet.homeName : context.bet.awayName, fx };
  const id = crypto.randomUUID();
  validate(); checkSession();
  acceptGtc(await createGtc(id, maker, plan));
  try {
    validate(); checkSession();
    await mutateGtc(id, { kind: "authorize_pm" });
    checkSession();
    const submittedAt = Date.now();
    try {
      const ack = await submit();
      const accepted = ack.success === true && Boolean(ack.orderID);
      await mutateGtc(id, { kind: "ack", state: accepted ? "accepted" : ack.success === false ? "rejected" : "unknown", orderId: ack.orderID, message: accepted ? "" : ack.errorMsg || "官方受理结果待核实，请勿重复下单" });
      const result = new BetResult("Polymarket", accepted, accepted ? "手动 GTC 已受理，成交继续核对" : "手动 GTC 未确认受理", { orderType: "GTC", source: "manual" }, ack);
      result.orderId = ack.orderID ?? null; result.link = plan.linkId; result.pending = accepted;
      result.saveLog(account, submittedAt);
    }
    catch (error) {
      await mutateGtc(id, { kind: "ack", state: "unknown", message: error instanceof Error ? error.message : "提交结果待核实，请勿重复下单" });
    }
  }
  finally {
    // 关闭的只是本次发送窗口，绝不取消 PM 剩余挂单；恢复时只查同一个订单。
    await mutateGtc(id, { kind: "close" });
  }
  await pollGtc(id).catch(() => {});
  return gtcExecutionResult(currentGtc(id));
}
