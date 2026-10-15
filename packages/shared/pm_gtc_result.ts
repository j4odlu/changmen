/** [changmen 扩展] 已确认 GTC 买单结果；不含发送授权、撤单过程或监控状态。 */
import type { GtcFill, GtcFinancialOrder } from "./pm_gtc";
export interface GtcConfirmedResult {
  executionId: string;
  orderId: string;
  playerId: number;
  linkId: number;
  createdAt: number;
  revision: number;
  match: string;
  bet: string;
  item: string;
  tokenId: string;
  conditionId: string;
  buyShares: string;
  principalUsdc: string;
  feeUsdc: string;
  fills: GtcFill[];
  financial: GtcFinancialOrder;
}
