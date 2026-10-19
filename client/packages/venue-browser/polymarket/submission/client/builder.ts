/** [Polymarket 可证实] CLOB V2 订单归因：Builder Profile 的 bytes32 builder code */
export const POLYMARKET_BUILDER_CODE_DEFAULT
  = "0x58ec38dac8719b354dfd2a47d6ac27ab01babea9102a993c1abe4af30ec2883f";

const BUILDER_CODE_RE = /^0x[0-9a-fA-F]{64}$/;

/** 优先 `VITE_POLY_BUILDER_CODE`（构建时注入），否则用 changmen 默认 builder code */
export function resolvePolymarketBuilderCode(): string {
  const fromEnv = typeof import.meta !== "undefined"
    ? (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_POLY_BUILDER_CODE
    : undefined;
  const code = (fromEnv?.trim() || POLYMARKET_BUILDER_CODE_DEFAULT).trim();
  if (!BUILDER_CODE_RE.test(code))
    throw new Error(`无效的 Polymarket builder code（需 0x + 64 位 hex）: ${code.slice(0, 12)}…`);
  return code;
}
