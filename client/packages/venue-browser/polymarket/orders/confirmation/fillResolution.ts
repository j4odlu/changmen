/** POST 回执优先解析买卖成交金额；必要时查询成交，delayed 卖单保留原重试与份额补充。 */
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { polymarketShareCount, parsePolymarketBuyOrderFill, parsePolymarketSellOrderFill } from "../history/orderTradeAmounts";
import { readPolymarketOrderFillAmounts } from "./orderFillReader";

/** POST 响应优先，/data/trades 兜底（拒单检测 / 卖出归因） */
export async function resolvePolymarketBuyFill(
  account: PlatformAccount,
  orderId: string,
  postResponse: { makingAmount?: string | number; takingAmount?: string | number } | null | undefined,
  _lookbackMs = 10 * 60 * 1000,
): Promise<{ stakeUsdc: number; shares: number }> {
  const fromPost = parsePolymarketBuyOrderFill(postResponse);
  if (fromPost.stakeUsdc > 0 && fromPost.shares > 0)
    return fromPost;

  const fill = await readPolymarketOrderFillAmounts(account, orderId, "BUY");
  if (fill) {
    const { shares, usdc } = fill;
    if (usdc > 0 && shares > 0)
      return { stakeUsdc: usdc, shares };
  }

  return fromPost;
}

function waitMs(ms: number) {
  return new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });
}

/** POST 响应优先，/data/trades 兜底 */
export async function resolvePolymarketSellFill(
  account: PlatformAccount,
  orderId: string,
  postResponse: { makingAmount?: string | number; takingAmount?: string | number } | null | undefined,
  _lookbackMs = 10 * 60 * 1000,
): Promise<{ proceedsUsdc: number; sharesSold: number }> {
  const fromPost = parsePolymarketSellOrderFill(postResponse);
  if (fromPost.proceedsUsdc > 0 && fromPost.sharesSold > 0)
    return fromPost;

  const fill = await readPolymarketOrderFillAmounts(account, orderId, "SELL");
  if (fill) {
    const { shares, usdc } = fill;
    if (usdc > 0 && shares > 0)
      return { proceedsUsdc: usdc, sharesSold: shares };
  }

  return fromPost;
}

export const POLYMARKET_SELL_FILL_RETRY_OPTS = {
  lookbackMs: 10 * 60 * 1000,
  retryMs: 2_000,
  maxRetries: 15,
} as const;

/**
 * 体育 delayed 卖单：POST 无 making/taking，trades 也可能滞后于 order 端点。
 * settle 后再轮询 trades；仍缺时用 orderRow.size_matched 补份数。
 */
export async function resolvePolymarketSellFillWithRetry(
  account: PlatformAccount,
  orderId: string,
  postResponse: { makingAmount?: string | number; takingAmount?: string | number } | null | undefined,
  opts?: {
    lookbackMs?: number;
    retryMs?: number;
    maxRetries?: number;
    orderRow?: { size_matched?: string | number } | null;
  },
): Promise<{ proceedsUsdc: number; sharesSold: number }> {
  const fromPost = parsePolymarketSellOrderFill(postResponse);
  if (fromPost.proceedsUsdc > 0 && fromPost.sharesSold > 0)
    return fromPost;

  const retryMs = opts?.retryMs ?? POLYMARKET_SELL_FILL_RETRY_OPTS.retryMs;
  const maxRetries = opts?.maxRetries ?? POLYMARKET_SELL_FILL_RETRY_OPTS.maxRetries;

  for (let i = 0; i < maxRetries; i++) {
    const fill = await readPolymarketOrderFillAmounts(account, orderId, "SELL", polymarketShareCount(opts?.orderRow?.size_matched));
    if (fill) {
      const { shares, usdc } = fill;
      if (usdc > 0 && shares > 0)
        return { proceedsUsdc: usdc, sharesSold: shares };
    }
    if (i < maxRetries - 1)
      await waitMs(retryMs);
  }

  const rowShares = polymarketShareCount(opts?.orderRow?.size_matched);
  // A partial receipt and a separate quantity are not a verified amount pair.
  if (fromPost.proceedsUsdc > 0)
    return fromPost;

  return {
    proceedsUsdc: fromPost.proceedsUsdc > 0 ? fromPost.proceedsUsdc : 0,
    sharesSold: rowShares > 0 ? rowShares : fromPost.sharesSold,
  };
}
