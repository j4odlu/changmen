import type { PolymarketTickSize as TickSize } from "./pmTickPrice";

export interface PolymarketOrderOptions {
  /** EIP-712 域版本：2=CTF 市场 v1，3=Protocol V2；与订单结构的 V2 命名不同。 */
  version: 2 | 3;
  bookTimestamp: number;
  tickSize: TickSize;
  minOrderSize: number;
  negRisk: boolean;
  asks: Array<{ price: number; size: number }>;
}
