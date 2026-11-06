export * from "../../web/src/stores/match/mainBetLoop";
import { runMainBetLoopTick as originalTick, type MainBetLoopState } from "../../web/src/stores/match/mainBetLoop";
import { runListenerMaintenance } from "./index";

/** Integration only: serialize the original body; keep its implementation and finally unchanged. */
export function runMainBetLoopTick(state: MainBetLoopState): Promise<void> {
  return runListenerMaintenance(() => originalTick(state));
}
