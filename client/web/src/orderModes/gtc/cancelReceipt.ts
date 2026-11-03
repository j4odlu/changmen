import type { PlatformAccount } from "@/models/platformAccount";

export interface GtcCancelReceipt {
  canceled?: string[];
  not_canceled?: Record<string, string>;
}

/** [changmen 扩展] 原单 HTTP 回执与账号隔离的 WS 撤单事件，任一先确认即可；成交核对独立进行。
 * 官方：https://docs.polymarket.com/trading/realtime-order-updates
 * 不增加人为撤单期限，不自动重发；传输超时由调用方标记未知并查询原单。
 */
export async function waitForGtcCancelReceipt(
  account: PlatformAccount,
  orderId: string,
  send: () => Promise<GtcCancelReceipt>,
  valid: () => boolean,
): Promise<GtcCancelReceipt> {
  let dispose: (() => void) | undefined;
  let confirmed = false;
  let confirm!: (receipt: GtcCancelReceipt) => void;
  const wsReceipt = new Promise<GtcCancelReceipt>(resolve => { confirm = resolve; });
  try {
    try {
      const api = await import("@changmen/venue-browser/adapter/polymarket");
      if (!valid()) throw new Error("GTC 会话或原账号已变更");
      const check = () => {
        if (!valid()) return;
        const status = String(api.readPolymarketOrderWatch(orderId, account)?.row?.status ?? "").toUpperCase();
        if (status === "CANCELED" || status === "CANCELLED") {
          confirmed = true;
          confirm({ canceled: [orderId] });
        }
      };
      // 先监听再发送，不等待 WS 连接；重用原账号已有连接和缓存。
      dispose = api.observePolymarketOrderWatch(account, orderId, check);
      check();
    }
    catch { /* WS 不可用时仍可通过原单 HTTP 回执确认。 */ }
    if (!valid()) throw new Error("GTC 会话或原账号已变更");
    if (confirmed) return await wsReceipt;
    return await Promise.race([wsReceipt, send()]);
  }
  finally { dispose?.(); }
}
