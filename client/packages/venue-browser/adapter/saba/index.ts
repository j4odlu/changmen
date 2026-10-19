import type { PlatformAdapter } from "../contract";
import { sabaProvider } from "./bet";
import { startSabaCollector } from "./collect";

export { sabaProvider, startSabaCollector };
export * from "./bet";
export * from "./collect";

export const sabaAdapter: PlatformAdapter = {
  id: "SABA",
  collector: startSabaCollector,
  provider: sabaProvider,
};
