import type { PlatformAdapter } from "../contract";
import { stakeProvider } from "./bet";
import { startStakeCollector } from "./collect";

export { stakeProvider, startStakeCollector };
export * from "./bet";
export * from "./collect";
export * from "./tabId";
export * from "./liveOdds";
export * from "./oddsPush";

export const stakeAdapter: PlatformAdapter = {
  id: "Stake",
  collector: startStakeCollector,
  provider: stakeProvider,
};
