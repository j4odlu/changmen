import type { GtcFeeProof } from "@changmen/shared/pm_gtc";
import { POLYMARKET_CLOB_API } from "../api";
import { computePolymarketPlatformFeeUsdc } from "../pmFee";
import { polymarketPluginGet } from "../transport";

/** [changmen 扩展] 仅成交核对读取；查询失败或曲线未知不能伪造零手续费。 */
export async function readGtcFeeProof(conditionId: string): Promise<GtcFeeProof | undefined> {
  const market = await polymarketPluginGet<{ fd?: { r?: unknown; e?: unknown; to?: unknown } }>(`${POLYMARKET_CLOB_API}/clob-markets/${encodeURIComponent(conditionId)}`);
  const fd = market?.fd;
  if (!fd || fd.r == null || !Number.isFinite(Number(fd.r)) || Number(fd.r) < 0 || Number(fd.e) !== 1 || fd.to !== true)
    return undefined;
  return { rate: Number(fd.r).toFixed(6), exponent: 1, takerOnly: true, observedAt: Date.now() };
}

/** [changmen 扩展] GTC 复用普通 PM 费用助手；V2 trade 的旧 bps 字段不是 fd.r。 */
export function resolveGtcFillFee(proof: GtcFeeProof | undefined, role: "MAKER" | "TAKER", shares: number, price: number): number | null {
  if (role === "MAKER")
    return 0;
  if (!proof || proof.exponent !== 1 || proof.takerOnly !== true
    || !Number.isFinite(Number(proof.rate)) || Number(proof.rate) < 0 || !(proof.observedAt > 0)) {
    return null;
  }
  return computePolymarketPlatformFeeUsdc({ shares, price, feeRate: Number(proof.rate), exponent: proof.exponent, takerOnly: proof.takerOnly, isTaker: true });
}
