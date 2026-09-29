export interface PolymarketOrderResponseLike {
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
  /** [changmen 扩展] 用户授权的本地超时判拒策略，不是官方取消回执。 */
  confirmationBasis?: "timeout_policy";
}

export type PolymarketPollOutcome = "matched" | "unfilled" | "timeout";
