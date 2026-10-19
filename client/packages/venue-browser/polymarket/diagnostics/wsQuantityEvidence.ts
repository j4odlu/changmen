/** [changmen 扩展] 留存数量字段的原始标量形状；不记录整帧、鉴权字段或任意错误正文。 */
export function polymarketWsQuantityEvidence(value: unknown, present: boolean): Record<string, unknown> {
  if (!present) return { kind: "missing" };
  if (value === null) return { kind: "null", raw: null };
  if (typeof value === "number")
    return Number.isFinite(value) ? { kind: "number", raw: value }
      : { kind: "non_finite_number", raw: String(value) };
  if (typeof value === "boolean") return { kind: "boolean", raw: value };
  if (typeof value !== "string") return { kind: Array.isArray(value) ? "array" : typeof value };
  const trimmed = value.trim();
  const kind = !trimmed ? "blank_string" : Number.isFinite(Number(value)) ? "numeric_string" : "invalid_string";
  // 数字、空白和明确的空/非有限数标记可原样保存；其它字符串仅留类型和长度。
  const safe = value.length <= 80
    && /^(?:[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[+-]?Infinity|NaN|null|undefined)?$/i.test(trimmed);
  return safe ? { kind, raw: value } : { kind, length: value.length, redacted: true };
}
