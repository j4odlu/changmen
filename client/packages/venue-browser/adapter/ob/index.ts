import type { PlatformAdapter } from "../contract";
import { obProvider } from "./bet";
import { startObCollector } from "./collect";

export { obProvider, startObCollector };
export * from "./bet";
export * from "./collect";
export { getObMqttSourceMode, cycleObMqttSourceModeAndReconnect, obMqttSourceModeLabel } from "./mqtt";
export type { ObMqttSourceMode } from "./mqtt";

export const obAdapter: PlatformAdapter = {
  id: "OB",
  collector: startObCollector,
  provider: obProvider,
};
