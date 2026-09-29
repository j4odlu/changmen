import type { PolymarketOrderRow } from "./orderTypes";

/** User WS 帧里与本订单相关的 order id（taker / maker / order 自身） */
export function polymarketUserOrderIdsFromMessage(msg: Record<string, unknown>): string[] {
  const ids: string[] = [];
  const push = (value: unknown) => {
    const id = String(value ?? "").trim();
    if (id)
      ids.push(id);
  };
  push(msg.taker_order_id);
  push(msg.id);
  const makerOrders = msg.maker_orders;
  if (Array.isArray(makerOrders)) {
    for (const row of makerOrders) {
      if (row && typeof row === "object")
        push((row as { order_id?: unknown }).order_id);
    }
  }
  return ids;
}

function messageRelatesToOrder(msg: Record<string, unknown>, watchOrderId: string): boolean {
  const target = watchOrderId.trim().toLowerCase();
  if (!target)
    return false;
  return polymarketUserOrderIdsFromMessage(msg).some(id => id.toLowerCase() === target);
}

/**
 * 解读 User Channel 单帧对指定 orderId 的终态。
 * 对齐官方 Real-Time Order Updates：
 * - Placement = 受理（含 delayed），非终态
 * - Update = 部分/全部成交（须 size_matched>0）
 * - Cancellation / status CANCELED = 剩余量取消 → unfilled
 * - unmatched/live 无成交：仍挂簿，非终态（等 FOK 系统 cancel / matched）
 */
export function interpretPolymarketUserWsMessage(
  raw: unknown,
  watchOrderId: string,
): "matched" | "unfilled" | null {
  if (!raw || typeof raw !== "object")
    return null;
  const msg = raw as Record<string, unknown>;
  if (!messageRelatesToOrder(msg, watchOrderId))
    return null;

  const eventType = String(msg.event_type ?? "").trim().toLowerCase();
  const type = String(msg.type ?? "").trim().toUpperCase();
  const orderStatus = String(msg.status ?? "").trim().toLowerCase();

  if (eventType === "order" || type === "PLACEMENT" || type === "UPDATE" || type === "CANCELLATION") {
    const sizeMatched = Number(msg.size_matched);
    if (Number.isFinite(sizeMatched) && sizeMatched > 0)
      return "matched";
    // [changmen 扩展] 取消只终止剩余量；缺少累计成交量时交给 REST 核对。
    if (type === "CANCELLATION" || orderStatus === "canceled" || orderStatus === "cancelled")
      return msg.size_matched != null && String(msg.size_matched).trim() !== "" && sizeMatched === 0
        && (!Array.isArray(msg.associate_trades) || msg.associate_trades.length === 0)
        ? "unfilled" : null;
    // PLACEMENT / delayed / live / unmatched：继续等系统 cancel 或成交
    if (
      type === "PLACEMENT"
      || orderStatus === "delayed"
      || orderStatus === "live"
      || orderStatus === "unmatched"
    ) {
      return null;
    }
    // 其它 UPDATE（无成交份额）继续等 trade / Cancellation
    return null;
  }

  if (eventType === "trade" || type === "TRADE") {
    const status = String(msg.status ?? "").trim().toUpperCase();
    if (status === "FAILED" || status === "TRADE_STATUS_FAILED")
      return null; // 单条 trade 失败不是整张订单未成交的证明。
    if (
      status === "MATCHED"
      || status === "MINED"
      || status === "CONFIRMED"
      || status === "RETRYING"
      || status === "TRADE_STATUS_MATCHED"
      || status === "TRADE_STATUS_MATCHED_NOT_BROADCASTED"
      || status === "TRADE_STATUS_MINED"
      || status === "TRADE_STATUS_CONFIRMED"
      || status === "TRADE_STATUS_RETRYING"
    ) {
      return "matched";
    }
  }
  return null;
}

export function polymarketOrderRowFromUserWsMessage(
  msg: Record<string, unknown>,
  outcome: "matched" | "unfilled",
): PolymarketOrderRow {
  if (outcome === "unfilled")
    return { status: "cancelled", size_matched: "0" };
  const size = msg.size_matched ?? msg.size;
  return {
    status: String(msg.status ?? "MATCHED"),
    size_matched: String(size ?? ""),
    original_size: msg.original_size == null ? undefined : String(msg.original_size),
    associate_trades: Array.isArray(msg.associate_trades)
      ? msg.associate_trades.map(String)
      : msg.event_type === "order" ? undefined : msg.id ? [String(msg.id)] : undefined,
  };
}
