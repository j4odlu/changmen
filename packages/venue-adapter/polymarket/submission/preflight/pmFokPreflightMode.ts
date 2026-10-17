import type { BetOption } from "@changmen/client-core/models/betOption";

/** [changmen 扩展] Extensions 偏好；只影响新 FOK 尝试，GTC 不读取此开关。 */
export type PmFokPreflightMode = "legacy" | "optimized";
let configuredMode: PmFokPreflightMode = "legacy";
const attempts = new WeakMap<BetOption, PmFokPreflightMode>();
const modeListeners = new Set<(mode: PmFokPreflightMode) => void>();
/** [changmen 扩展] 读取已应用的偏好，不能用尚未保存的表单值启动影子任务。 */
export const getPmFokPreflightMode = (): PmFokPreflightMode => configuredMode;
export function onPmFokPreflightModeChange(listener: (mode: PmFokPreflightMode) => void): () => void {
  modeListeners.add(listener);
  return () => { modeListeners.delete(listener); };
}

export function setPmFokPreflightMode(value: unknown): void {
  configuredMode = value === "optimized" ? "optimized" : "legacy";
  for (const listener of modeListeners) { try { listener(configuredMode); } catch { /* optional observer */ } }
}

export function capturePmFokPreflightMode(option: BetOption): PmFokPreflightMode {
  const captured = attempts.get(option);
  if (captured) return captured;
  attempts.set(option, configuredMode);
  return configuredMode;
}
