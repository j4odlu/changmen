import type { PolymarketTickSize as TickSize } from "./pmTickPrice";

export interface PolymarketOrderOptions {
  version: 2 | 3;
  bookTimestamp: number;
  tickSize: TickSize;
  minOrderSize: number;
  negRisk: boolean;
  asks: Array<{ price: number; size: number }>;
}
