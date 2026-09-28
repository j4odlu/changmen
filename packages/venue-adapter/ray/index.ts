import type { PlatformAdapter } from "../contract";
import { rayProvider } from "./bet";
import { startRayCollector } from "./collect";

export { rayProvider, startRayCollector };
export * from "./bet";
export * from "./collect";
export {
  cycleRayWsSourceModeAndReconnect,
  getRayWsSourceMode,
  rayWsSourceModeLabel,
} from "./collect";
export type { RayWsSourceMode } from "./collect";
export {
  fetchRayFootballAsClientMatchDtos,
  rayFootballRowToClientMatchDto,
  RAY_FOOTBALL_GAME_ID,
} from "./sportFootball";
export { createRayRealtimeClient } from "./realtime";
export type { RayRealtimeClient, RayRealtimeMessage } from "./realtime";

export const rayAdapter: PlatformAdapter = {
  id: "RAY",
  collector: startRayCollector,
  provider: rayProvider,
};
