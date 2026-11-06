/** 成交快照处理：归属筛选、分笔展开、确认状态、金额汇总与加权均价；不读取外部状态。 */
import type { PolymarketTradeRow, PolymarketMakerOrderRow } from "./orderTradeTypes";
import { polymarketBuyStakeUsdc, polymarketShareCount, round4 } from "./orderTradeAmounts";
import { normalizeEthAddress } from "../../ethAddress";

/** 按 CLOB orderId 收集 transaction_hash（多 bucket 可多笔） */
export function collectPolymarketOrderTxHashes(
  trades: PolymarketTradeRow[] | null | undefined,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (!Array.isArray(trades))
    return map;
  for (const trade of trades) {
    if (!isPolymarketTradeConfirmed(trade.status))
      continue;
    const orderId = String(trade.taker_order_id ?? "").trim().toLowerCase();
    const tx = String(trade.transaction_hash ?? "").trim().toLowerCase();
    if (!orderId || !/^0x[0-9a-f]{64}$/.test(tx))
      continue;
    const list = map.get(orderId) ?? [];
    if (!list.includes(tx))
      list.push(tx);
    map.set(orderId, list);
  }
  return map;
}

/** 已成交 trade 是否计入订单列表（含 MINED，排除 FAILED/CANCEL） */
export function isPolymarketTradeConfirmed(status: string | undefined): boolean {
  const normalized = String(status ?? "").trim().toUpperCase();
  if (!normalized) return false;
  if (normalized.includes("FAILED") || normalized.includes("CANCEL")) return false;
  return normalized.includes("CONFIRMED")
    || normalized.includes("MATCHED")
    || normalized.includes("MINED")
    || normalized.includes("RETRYING");
}

/**
 * MAKER 撮合里 maker_orders 含对手挂单；只保留 maker_address / owner 属于本账户的腿。
 * userAddresses 为空时不做地址过滤（单测兼容旧 payload）。
 */
export function isUserMakerOrderLeg(
  mo: PolymarketMakerOrderRow,
  trade: PolymarketTradeRow,
  userAddresses?: ReadonlySet<string>,
): boolean {
  if (!userAddresses || userAddresses.size === 0)
    return true;

  const moMaker = normalizeEthAddress(mo.maker_address);
  if (moMaker)
    return userAddresses.has(moMaker);

  const moOwner = String(mo.owner ?? "").trim();
  const tradeOwner = String(trade.owner ?? "").trim();
  if (moOwner && tradeOwner)
    return moOwner === tradeOwner;

  return false;
}

/** trade 是否关联指定 CLOB orderId（taker 或 maker_orders） */
export function polymarketTradeRefsOrderId(trade: PolymarketTradeRow, orderId: string): boolean {
  const id = String(orderId ?? "").trim().toLowerCase();
  if (!id)
    return false;
  if (String(trade.taker_order_id ?? "").trim().toLowerCase() === id)
    return true;
  const makers = trade.maker_orders;
  if (!Array.isArray(makers))
    return false;
  return makers.some(mo => String(mo.order_id ?? "").trim().toLowerCase() === id);
}

/** MAKER 成交在 maker_orders；TAKER 用 taker_order_id */
export function flattenPolymarketTrades(
  trades: PolymarketTradeRow[],
  userAddresses?: ReadonlySet<string>,
): PolymarketTradeRow[] {
  const out: PolymarketTradeRow[] = [];
  for (const trade of trades) {
    const role = String(trade.trader_side ?? trade.type ?? "").trim().toUpperCase();
    if (role.includes("MAKER") && Array.isArray(trade.maker_orders) && trade.maker_orders.length) {
      for (const mo of trade.maker_orders) {
        if (!isUserMakerOrderLeg(mo, trade, userAddresses))
          continue;
        const orderId = String(mo.order_id ?? "").trim();
        if (!orderId) continue;
        out.push({
          ...trade,
          taker_order_id: orderId,
          size: mo.matched_amount ?? trade.size,
          price: mo.price ?? trade.price,
          outcome: mo.outcome ?? trade.outcome,
          asset_id: mo.asset_id ?? trade.asset_id,
          side: mo.side ?? trade.side ?? "BUY",
        });
      }
      continue;
    }
    const orderId = String(trade.taker_order_id ?? "").trim();
    if (orderId)
      out.push(trade);
  }
  return out;
}

/** 合并后 price 保留精度（与 CLOB 小数价一致） */
function formatPolymarketVwapPrice(notionalUsdc: number, shares: number): string {
  if (!Number.isFinite(notionalUsdc) || !Number.isFinite(shares) || shares <= 0 || notionalUsdc <= 0)
    return "";
  const vwap = Math.round((notionalUsdc / shares) * 1_000_000) / 1_000_000;
  return String(vwap);
}

/** 同一 taker_order_id 多 bucket 合并；price 为各腿 USDC 加权均价（VWAP） */
export function aggregatePolymarketTrades(trades: PolymarketTradeRow[]): PolymarketTradeRow[] {
  const byOrder = new Map<string, PolymarketTradeRow & { _sizeSum: number; _notionalSum: number }>();
  for (const trade of trades) {
    if (String(trade.side ?? "").trim().toUpperCase() !== "BUY") continue;
    if (!isPolymarketTradeConfirmed(String(trade.status ?? ""))) continue;
    const orderId = String(trade.taker_order_id ?? "").trim();
    if (!orderId) continue;

    const size = Number(trade.size) || 0;
    const price = Number(trade.price);
    const notional = Number.isFinite(price) && price > 0
      ? polymarketBuyStakeUsdc(trade.size, price)
      : 0;
    const matchSec = Number(trade.match_time) || 0;
    const existing = byOrder.get(orderId);
    if (!existing) {
      byOrder.set(orderId, {
        ...trade,
        taker_order_id: orderId,
        _sizeSum: size,
        _notionalSum: notional,
      });
      continue;
    }
    existing._sizeSum += size;
    existing._notionalSum += notional;
    if (matchSec >= (Number(existing.match_time) || 0))
      existing.match_time = trade.match_time;
  }

  return [...byOrder.values()].map(({ _sizeSum, _notionalSum, ...rest }) => {
    const shares = polymarketShareCount(_sizeSum);
    const vwapPrice = formatPolymarketVwapPrice(_notionalSum, shares);
    return {
      ...rest,
      size: String(_sizeSum),
      ...(vwapPrice ? { price: vwapPrice } : {}),
    };
  });
}

/** 同一 taker_order_id 多 bucket 合并 SELL */
export function aggregatePolymarketSellTrades(trades: PolymarketTradeRow[]): PolymarketTradeRow[] {
  const byOrder = new Map<string, PolymarketTradeRow & { _sizeSum: number; _notionalSum: number }>();
  for (const trade of trades) {
    if (String(trade.side ?? "").trim().toUpperCase() !== "SELL")
      continue;
    if (!isPolymarketTradeConfirmed(String(trade.status ?? "")))
      continue;
    const orderId = String(trade.taker_order_id ?? "").trim();
    if (!orderId)
      continue;

    const size = Number(trade.size) || 0;
    const price = Number(trade.price);
    const shareSize = polymarketShareCount(size);
    const notional = Number.isFinite(price) && price > 0 && shareSize > 0
      ? round4(shareSize * price)
      : 0;
    const matchSec = Number(trade.match_time) || 0;
    const existing = byOrder.get(orderId);
    if (!existing) {
      byOrder.set(orderId, {
        ...trade,
        taker_order_id: orderId,
        _sizeSum: size,
        _notionalSum: notional,
      });
      continue;
    }
    existing._sizeSum += size;
    existing._notionalSum += notional;
    if (matchSec >= (Number(existing.match_time) || 0))
      existing.match_time = trade.match_time;
  }

  return [...byOrder.values()].map(({ _sizeSum, _notionalSum, ...rest }) => {
    const shares = polymarketShareCount(_sizeSum);
    const vwapPrice = formatPolymarketVwapPrice(_notionalSum, shares);
    return {
      ...rest,
      size: String(_sizeSum),
      ...(vwapPrice ? { price: vwapPrice } : {}),
    };
  });
}
