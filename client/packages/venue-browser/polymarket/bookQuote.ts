export interface PolymarketBook {
  asset_id?: string;
  bids?: PolymarketPriceLevel[];
  asks?: PolymarketPriceLevel[];
  timestamp?: string | number;
}

export interface PolymarketPriceLevel {
  price?: string | number;
  size?: string | number;
}

export function bestAskFromBook(book: PolymarketBook | undefined): number {
  const asks = book?.asks ?? [];
  let best = Number.POSITIVE_INFINITY;
  for (const level of asks) {
    const price = Number(level.price);
    const size = Number(level.size);
    if (Number.isFinite(price) && price > 0 && price < best && (!Number.isFinite(size) || size > 0)) {
      best = price;
    }
  }
  return Number.isFinite(best) ? best : 0;
}
