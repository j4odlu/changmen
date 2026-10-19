import type { PlatformAdapter } from "../contract";
import { dexProvider } from "./bet";
import { startDexCollector } from "./collect";

export { dexProvider, startDexCollector };
export * from "./bet";
export * from "./collect";
export * from "./socket";

export const dexAdapter: PlatformAdapter = {
  id: "Dex",
  collector: startDexCollector,
  provider: dexProvider,
};
