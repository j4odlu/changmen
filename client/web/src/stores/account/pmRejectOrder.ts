import type { BetOption } from "@changmen/client-core/models/betOption";
import type { BetResult } from "@changmen/client-core/models/betResult";
import type { PlatformAccount } from "@/models/platformAccount";
import type { VenueOrder } from "@changmen/venue-adapter/contract";
import {
  buildPolymarketExecutionRejectVenueOrder,
  isPolymarketPostedApiFailure,
  type PolymarketExecutionRejectReason,
  type PolymarketRejectOrderContext,
} from "@changmen/venue-adapter/polymarket";
import { saveOrders } from "@/api/order";
import { resolveOrderItemLabel } from "@/shared/orderItemDisplay";
import { refreshOrderListAfterBind } from "@/stores/betting/arbOrderBind";

/** Reject 落库选项：队名优先，避免管理端只看到 Home/Away */
function itemLabelFromBetOption(option: BetOption): string {
  const target = String(option.target ?? "").trim();
  const named = option.target === "Away"
    ? String(option.bet?.awayName ?? "").trim()
    : String(option.bet?.homeName ?? "").trim();
  if (named)
    return named;
  const matchTitle = String(option.match?.title ?? "");
  const fromMatch = resolveOrderItemLabel(target, matchTitle);
  if (fromMatch && fromMatch !== target)
    return fromMatch;
  return target;
}

function contextFromBetOption(
  option: BetOption | undefined,
  linkId?: number,
): PolymarketRejectOrderContext {
  const link = Number(linkId) || 0;
  if (!option) {
    return link ? { link } : {};
  }
  // checkBetting 后 option.betMoney 已是场馆 USDC；build 内再 scale→CNY + pmStakeUsdc
  return {
    betMoney: Number(option.betMoney) || 0,
    odds: Number(option.odds) || 0,
    game: String(option.match?.game ?? ""),
    match: String(option.match?.title ?? ""),
    bet: String(option.bet?.getBetName?.() ?? ""),
    item: itemLabelFromBetOption(option),
    ...(link ? { link } : {}),
  };
}

/**
 * [changmen 扩展] 已执行 PM 下单但未成交 → 落库 Reject，供平台拒单率统计。
 * - unfilled：settle 确认 FOK/取消，或用户授权的买入超时判拒（result.message 保留依据）
 * - api_failed：已 POST 但未成交（常无官方 orderId，用合成 id）
 * - 金额：对齐成交单（pmStakeUsdc=U，betMoney=CNY）；勿把场馆 U 直接写入 betMoney
 * 不改补单/判定；timeout 勿调用。预检 / POST 前失败勿调用。
 */
export async function persistPolymarketExecutionReject(
  account: PlatformAccount,
  result: BetResult,
  reason: PolymarketExecutionRejectReason,
  opts?: { betOption?: BetOption; linkId?: number },
): Promise<VenueOrder | null> {
  if (String(account.provider ?? "").trim() !== "Polymarket")
    return null;
  if (reason !== "unfilled" && reason !== "api_failed")
    return null;
  // api_failed 仅统计已 POST；unfilled 已由买入收尾层作出业务决定
  if (reason === "api_failed" && !isPolymarketPostedApiFailure(result))
    return null;
  const order = buildPolymarketExecutionRejectVenueOrder(
    account,
    result,
    reason,
    contextFromBetOption(opts?.betOption, opts?.linkId),
  );
  if (!String(order.orderId ?? "").trim())
    return null;
  try {
    await saveOrders(account, [order]);
    // Reject 已经是可展示终态，不应继续等待另一腿的拒单检测才出现在侧栏。
    refreshOrderListAfterBind();
    return order;
  }
  catch (err) {
    console.warn("[Polymarket] persist execution reject failed", err);
    return null;
  }
}

export { isPolymarketPostedApiFailure };
