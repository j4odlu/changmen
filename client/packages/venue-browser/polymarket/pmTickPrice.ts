/**
 * [Polymarket 可证实] 限价必须对齐市场 tick，否则 INVALID_ORDER_MIN_TICK_SIZE。
 * @see https://docs.polymarket.com/trading/orders/overview
 */

/** 官方文档列出的 tick（含 World Cup 等 0.0025） */
export type PolymarketTickSize = "0.1" | "0.01" | "0.005" | "0.001" | "0.0001" | "0.0025";

const TICK_EPS = 1e-12;

function tickDecimals(step: number): number {
  const frac = String(step).split(".")[1];
  return Math.min(8, Math.max(0, frac?.length ?? 0));
}

function roundTick(n: number, step: number): number {
  return Number(n.toFixed(tickDecimals(step)));
}

export function normalizePolymarketTickSize(value: string | number | undefined): PolymarketTickSize {
  const tick = String(value ?? "").trim();
  if (
    tick === "0.1"
    || tick === "0.01"
    || tick === "0.005"
    || tick === "0.001"
    || tick === "0.0001"
    || tick === "0.0025"
  ) {
    return tick;
  }
  throw new Error(`Polymarket 返回了不支持的 tick_size: ${tick || "空"}`);
}

export function polymarketTickStep(tick: string | number): number {
  const n = Number(tick);
  if (!Number.isFinite(n) || n <= 0)
    throw new Error(`无效 tick: ${tick}`);
  return n;
}

/** 价格是否为 tick 整数倍（官方拒单条件的反面） */
export function isPolymarketPriceOnTick(price: number, tick: string | number): boolean {
  if (!Number.isFinite(price) || price <= 0 || price >= 1)
    return false;
  const step = polymarketTickStep(tick);
  const ratio = price / step;
  return Math.abs(ratio - Math.round(ratio)) < 1e-8;
}

/**
 * 将价格对齐到 tick。
 * - mode `floor`：向下（卖出限价常用）
 * - mode `ceil`：向上
 * - mode `round`：四舍五入到最近 tick
 */
export function alignPolymarketPriceToTick(
  price: number,
  tick: string | number,
  mode: "floor" | "ceil" | "round" = "floor",
): number {
  const step = polymarketTickStep(tick);
  if (!Number.isFinite(price))
    throw new Error(`无效价格: ${price}`);
  const scaled = price / step;
  let n: number;
  if (mode === "ceil")
    n = Math.ceil(scaled - TICK_EPS);
  else if (mode === "round")
    n = Math.round(scaled);
  else
    n = Math.floor(scaled + TICK_EPS);
  return roundTick(n * step, step);
}
