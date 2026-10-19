import type { PlatformId } from "@changmen/api-contract";

/** pickArbLegs 仅用 provider + profit 覆盖门槛；避免 web 扩展 PlatformAccount 类型分叉 */
export interface ArbProfitAccount {
  provider: PlatformId;
  profit: number;
}
