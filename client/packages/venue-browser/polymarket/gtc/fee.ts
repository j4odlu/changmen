import type { GtcFeeProof } from "@changmen/shared/pm_gtc_order";
import { POLYMARKET_CLOB_API } from "../api";
import { polymarketPluginGet } from "../transport/transport";

/** 只接受数值字段；JS 的空串、布尔或数组强转结果不是有效费率证据。 */
export function parseGtcFeeProof(fd: { r?: unknown; e?: unknown; to?: unknown } | null | undefined): GtcFeeProof | undefined {
  const numeric = (value: unknown) => (typeof value === "number" || (typeof value === "string"
    && /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())))
    && Number.isFinite(Number(value));
  if (!fd || !numeric(fd.r) || !numeric(fd.e) || Number(fd.r) < 0 || Number(fd.e) !== 1 || fd.to !== true)
    return undefined;
  return { rate: Number(fd.r).toFixed(6), exponent: 1, takerOnly: true, observedAt: Date.now() };
}

/** [changmen 扩展] 仅成交核对读取；查询失败或曲线未知不能伪造零手续费。 */
export async function readGtcFeeProof(conditionId: string): Promise<GtcFeeProof | undefined> {
  const market = await polymarketPluginGet<{ fd?: { r?: unknown; e?: unknown; to?: unknown } }>(`${POLYMARKET_CLOB_API}/clob-markets/${encodeURIComponent(conditionId)}`);
  return parseGtcFeeProof(market?.fd);
}
