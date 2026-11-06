/** 官方成交快照类型；不引入同步调度或网络实现。 */

export interface PolymarketTradeRow {
  id?: string;
  taker_order_id?: string;
  market?: string;
  asset_id?: string;
  side?: string;
  size?: string | number;
  price?: string | number;
  status?: string;
  match_time?: string | number;
  outcome?: string;
  bucket_index?: number;
  trader_side?: string;
  type?: string;
  owner?: string;
  maker_address?: string;
  /** 链上成交 tx；与 Data API `/activity.transactionHash` 1:1 对齐 */
  transaction_hash?: string;
  maker_orders?: PolymarketMakerOrderRow[];
}

export interface PolymarketMakerOrderRow {
  order_id?: string;
  owner?: string;
  maker_address?: string;
  matched_amount?: string | number;
  price?: string | number;
  outcome?: string;
  asset_id?: string;
  side?: string;
}
