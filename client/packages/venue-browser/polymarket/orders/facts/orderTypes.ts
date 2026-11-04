export interface PolymarketOrderResponseLike {
  /** 原始 POST /order 回执：六位整数基本单位，BUY 为金额，SELL 为份数。 */
  makingAmount?: string | number;
  success?: boolean;
  status?: string;
  orderID?: string;
  takingAmount?: string | number;
}

export interface PolymarketOrderRow {
  id?: string;
  status?: string;
  size_matched?: string | number;
  original_size?: string | number;
  associate_trades?: string[];
  order_type?: string;
  /** [changmen 扩展] 本地核验诊断，不是场馆订单状态。 */
  lookupError?: string;
  /** [changmen 扩展] 区分本地超时策略与官方 trade 永久失败证据。 */
  confirmationBasis?: "timeout_policy" | "trade_failed";
}

export type PolymarketPollOutcome = "matched" | "unfilled" | "timeout";
