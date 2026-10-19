import type { ObservationContext } from "@changmen/shared/order_observation";
import type { VenueOrder, VenueOrderStatus } from "@changmen/venue-browser/adapter/contract";

export type RayOrderSide = "A" | "B";

export type RayOrderContextStatus
  = | "binding"
    | "watching"
    | "ambiguous"
    | "rejected"
    | "closed";

export type RayLateRejectMakeupStatus
  = | "disabled"
    | "enqueuing"
    | "enqueued"
    | "skipped"
    | "failed";

export interface RayOrderContext {
  observation?: ObservationContext;
  key: string;
  userId: string;
  linkId: number;
  matchId: number;
  betId: number;
  side: RayOrderSide;
  accountId: number;
  submittedAt: number;
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
  status: RayOrderContextStatus;
  boundOrderId?: string;
  boundAt?: number;
  candidateCount: number;
  pollCount: number;
  /** [changmen 扩展] 用户端已唯一确认原单身份；不代表订单已落库。 */
  monitorBound?: boolean;
  /** 原单已保存并确认归属当前 Link；仅订单同步或数据库恢复置位。 */
  bindingSaved?: boolean;
  /** 正常同步已完成原单保存；Link 绑定失败后由后续正常同步重试。 */
  orderSaved?: boolean;
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

export interface RegisterRayOrderContextInput {
  observation?: ObservationContext;
  linkId: number;
  matchId: number;
  betId: number;
  side: RayOrderSide;
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
