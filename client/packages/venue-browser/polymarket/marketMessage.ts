export interface PolymarketWsPriceChange {
  asset_id?: string;
  price?: string;
  size?: string;
  side?: string;
  best_bid?: string;
  best_ask?: string;
  hash?: string;
}

export interface PolymarketWsMessage {
  event_type?: string;
  asset_id?: string;
  market?: string;
  timestamp?: string | number;
  hash?: string;
  // best_bid_ask event
  best_ask?: string;
  best_bid?: string;
  spread?: string;
  // book event (initial_dump snapshot)
  bids?: Array<{ price?: string | number; size?: string | number }>;
  asks?: Array<{ price?: string | number; size?: string | number }>;
  // price_change event
  price_changes?: PolymarketWsPriceChange[];
}
