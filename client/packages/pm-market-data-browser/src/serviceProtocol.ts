import type { MarketStreamEvent } from "./marketStreamProtocol";
import type { DepthView, FullBookView } from "./bookStore";
export type ServiceRequest =
  | { type: "watch"; enabled: boolean }
  | { type: "stream"; event: MarketStreamEvent; generation: number }
  | { type: "assets"; ids: string[]; generation: number }
  | { type: "attach"; scope: number }
  | { type: "detach"; scope: number }
  | { type: "consumer"; scope: number; payload: unknown }
  | { type: "depth"; id: number; asset: string; levels: number; generation: number }
  | { type: "full_book"; id: number; asset: string; generation: number; deadline: number };
export type ServiceMessage = { type: "batch"; id: number; requests: ServiceRequest[] };
export type ServiceResponse =
  | { type: "book_invalidated"; assets?: readonly string[] }
  | { type: "changed" }
  | { type: "batch_ack"; id: number }
  | { type: "consumer"; scope: number; payload: unknown }
  | { type: "depth"; id: number; generation: number; view: DepthView }
  | { type: "full_book"; id: number; generation: number; view: FullBookView };
export type WorkerPort = Pick<Worker, "postMessage" | "terminate" | "onmessage" | "onerror" | "onmessageerror">;
