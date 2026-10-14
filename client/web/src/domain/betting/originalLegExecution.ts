import type { BetOption } from "@changmen/client-core/models/betOption";
import type { BetResult } from "@changmen/client-core/models/betResult";
import type { VenueOrder } from "@changmen/venue-adapter/contract";

/** [changmen 扩展] 原单事实与动作许可供公共套利阶段消费，场馆实现不调度双腿。 */
export interface OriginalLegFacts {
  submission: "not_attempted" | "in_flight" | "accepted" | "rejected" | "unknown";
  fill: "none" | "partial" | "full" | "unknown";
  matchedShares?: string;
  remainingShares?: string | null;
}

export interface OriginalLegExecution {
  validate: () => void;
  submit: () => Promise<BetResult>;
  canContinueOriginalPair: () => boolean;
  /** 等待由公共 settle 承担，原单确认不再重复等待。 */
  confirm: (result: BetResult) => Promise<{
    orders: VenueOrder[];
    rejected: boolean;
    pendingConfirm: boolean;
  }>;
  facts: () => OriginalLegFacts;
  markConfirmed: () => void;
  rejectWaitSec: number;
}

export interface OriginalExecutionLifecycle {
  legs: ReadonlyMap<BetOption, OriginalLegExecution>;
  actions: { retry: boolean; makeup: boolean; autoSell: boolean; registerRejectMonitor: boolean; broadcast: boolean };
  close: () => Promise<void>;
  summary: () => { message: string; traceStatus: "success" | "partial" | "fail"; failed: boolean };
}
