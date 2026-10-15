import type { BetOption } from "@changmen/client-core/models/betOption";

/** [changmen 扩展] Extensions 偏好；只影响新 FOK 尝试，GTC 不读取此开关。 */
export type PmFokPreflightMode = "legacy" | "optimized";
let configuredMode: PmFokPreflightMode = "legacy";
const attempts = new WeakMap<BetOption, PmFokPreflightMode>();

export function setPmFokPreflightMode(value: unknown): void {
  configuredMode = value === "optimized" ? "optimized" : "legacy";
}

export function capturePmFokPreflightMode(option: BetOption): PmFokPreflightMode {
  const captured = attempts.get(option);
  if (captured) return captured;
  attempts.set(option, configuredMode);
  return configuredMode;
}
