import type { ShadowAttempt } from "./shadowObserver";
import type { ShadowSample, WsBookShadowRuntime } from "./bookRuntime";
import type { MarketStreamEvent } from "../../../../realtime/marketStreamProtocol";

export interface ShadowHttpSummary {
  price?: number;
  metadataClockAt?: number;
  orderOptions?: { bookTimestamp?: number; asks: Array<{ price: number; size: number }>;
    version?: number; tickSize?: string; minOrderSize?: number; negRisk?: boolean };
}
export type ShadowWorkerRequest =
  | { type: "stream"; id: number; generation: number; event: MarketStreamEvent }
  | { type: "assets"; ids: string[]; generation: number }
  | { type: "begin"; id: number; attempt: ShadowAttempt; sentAt: number }
  | { type: "finish"; id: number; raw?: ShadowHttpSummary; failed: boolean; sentAt: number }
  | { type: "cancel"; id: number };
export type ShadowWorkerResponse =
  | { type: "batch_ack"; id: number }
  | { type: "stream_ack"; id: number }
  | { type: "metadata"; generation: number; revision: number; entries: ReturnType<WsBookShadowRuntime["executionMetadata"]> }
  | { type: "sample"; id: number; sample: ShadowSample }
  | { type: "report"; generation: number; report: Omit<ReturnType<WsBookShadowRuntime["report"]>, "executionMetadata"> };
export const observerClock = () => performance.timeOrigin + performance.now();
export type ShadowWorkerMessage = ShadowWorkerRequest | { type: "batch"; id: number; requests: ShadowWorkerRequest[] };
