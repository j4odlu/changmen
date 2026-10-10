import type { GtcFeeProof } from "@changmen/shared/pm_gtc";
import { computePolymarketPlatformFeeUsdc } from "../pmFee";

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
