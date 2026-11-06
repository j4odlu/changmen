/** 纯地址格式规范化；不访问凭证、账户或签名逻辑。 */
/** 0x 地址小写规范化（非法则空串） */
export function normalizeEthAddress(raw: string | undefined | null): string {
  const s = String(raw ?? "").trim().toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(s) ? s : "";
}
