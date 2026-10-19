import type { PlatformAdapter } from "../contract";
import { startAzuroCollector } from "./collect";

export { startAzuroCollector };
export * from "./api";
export * from "./collect";
export * from "./parse";
export * from "./ws";

export const azuroAdapter: PlatformAdapter = {
  id: "Azuro",
  collector: startAzuroCollector,
};
