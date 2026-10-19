import type { PlatformAdapter } from "../contract";
import { iaProvider } from "./bet";
import { startIaCollector } from "./collect";

export { iaProvider, startIaCollector };
export * from "./bet";
export * from "./collect";

export const iaAdapter: PlatformAdapter = {
  id: "IA",
  collector: startIaCollector,
  provider: iaProvider,
};
