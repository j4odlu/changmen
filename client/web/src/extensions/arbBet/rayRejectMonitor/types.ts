import type { ObservationContext } from "@changmen/shared/order_observation";
import type { VenueOrder, VenueOrderStatus } from "@changmen/venue-adapter/contract";

export type RayRejectMonitorSide = "A" | "B";

export type RayRejectMonitorStatus
  = | "binding"
    | "watching"
    | "ambiguous"
    | "rejected"
    | "closed"
    | "expired";

export type RayLateRejectMakeupStatus
  = | "disabled"
    | "enqueuing"
    | "enqueued"
    | "skipped"
    | "failed";

export interface RayRejectMonitorTask {
  observation?: ObservationContext;
  key: string;
  userId: string;
  linkId: number;
  matchId: number;
  betId: number;
  side: RayRejectMonitorSide;
  accountId: number;
  submittedAt: number;
  monitorMinutes: number;
  expiresAt: number;
  match: string;
  bet: string;
  item: string;
  target: "Home" | "Away";
  odds: number;
  betMoney: number;
  /** 已确认的另一腿，作为现有补单策略的成功腿锚点。 */
  anchorConfirmed: boolean;
  anchorProvider: string;
  anchorAccountId: number;
  anchorBetMoney: number;
  anchorOdds: number;
  status: RayRejectMonitorStatus;
  boundOrderId?: string;
  boundAt?: number;
  candidateCount: number;
  pollCount: number;
  nextPollAt: number;
  lastPollAt?: number;
  lastObservedStatus?: VenueOrderStatus | "missing";
  lastError?: string;
  rejectedAt?: number;
  rejectDelayMs?: number;
  autoMakeupStatus?: RayLateRejectMakeupStatus;
  autoMakeupReason?: string;
  autoMakeupAt?: number;
  updatedAt: number;
}

export interface RegisterRayRejectMonitorInput {
  observation?: ObservationContext;
  linkId: number;
  matchId: number;
  betId: number;
  side: RayRejectMonitorSide;
  accountId: number;
  submittedAt: number;
  match: string;
  bet: string;
  item: string;
  target: "Home" | "Away";
  odds: number;
  betMoney: number;
  anchorConfirmed: boolean;
  anchorProvider: string;
  anchorAccountId: number;
  anchorBetMoney: number;
  anchorOdds: number;
  initialOrders: VenueOrder[];
  initialRejected: boolean;
}

export interface RayOrderCandidate {
  order: VenueOrder;
  score: number;
  reasons: string[];
}

export type RayOrderMatchResult
  = | { kind: "matched"; candidate: RayOrderCandidate; candidates: RayOrderCandidate[] }
    | { kind: "ambiguous"; candidates: RayOrderCandidate[] }
    | { kind: "missing"; candidates: RayOrderCandidate[] };
