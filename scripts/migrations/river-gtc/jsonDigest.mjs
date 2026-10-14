import { createHash } from "node:crypto";
// [changmen 扩展] 沿用原迁移凭据的规范化格式，不依赖已退休的存储模式工具。
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, canonical(value[k])]));
  if (typeof value === "number" && !Number.isFinite(value)) throw Error("NONFINITE_ARTIFACT");
  return value;
}
export const digest = value => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
