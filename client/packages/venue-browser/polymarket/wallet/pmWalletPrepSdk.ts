/** [changmen 扩展] 旧选型 API 的兼容入口；钱包准备统一使用官方 ESM SDK。 */
export type PmWalletPrepSdk = "legacy" | "unified";

/** @deprecated 钱包准备固定使用 unified；历史环境变量和本地设置不再切换 SDK。 */
export function resolvePmWalletPrepSdk(): "unified" {
  return "unified";
}

/** @deprecated 兼容已有调用，旧 SDK 已退役。 */
export function setPmWalletPrepSdkForTests(_sdk: PmWalletPrepSdk | null): void {}

/** @deprecated 兼容已有调用，旧 SDK 已退役。 */
export function setPmWalletPrepSdk(_sdk: PmWalletPrepSdk): void {}
