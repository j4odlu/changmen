import type { ObservationContext } from "@changmen/shared/order_observation";
import type { BetSide } from "../models/match";

/** 对齐 A8 bundle `eb` 持久化形状 */
export interface LoseOrderRecord {
  /** [changmen 扩展] 只保留旁路元数据，业务队列仍按 betId 索引。 */
  observation?: ObservationContext;
  pendingObservation?: ObservationContext;
  /** [changmen 扩展] 绑定原单/账号的 USDC 提交证据；旧金额字段不能代替它。 */
  pendingPmSubmission?: import("@changmen/shared/pm_submission").PmSubmission;
  accountId: number;
  matchId: number;
  betId: number;
  target: BetSide;
  betMoney: number;
  betOdds: number;
  match: string;
  bet: string;
  linkId: number;
  createAt: number;
  isCreateOrder: boolean;
  betCount: number;
  /**
   * [changmen 扩展] 受理后确认场馆（PM delayed / PF）jb：timeout 后续轮 settle，避免重复 POST
   * 读兼容旧键 pendingPmOrderId
   */
  pendingVenueSubmittedAt?: number;
  pendingVenueOdds?: number;
  pendingVenueBetMoney?: number;
  pendingVenueError?: string;
  pendingVenueOrderId?: string;
  pendingVenueAccountId?: number;
  /** pending 原单是待补目标腿，还是可能成为补单锚点的腿 */
  pendingVenueRole?: "target" | "anchor";
  /** pending 原单真实方向；anchor 模式下与 LoseOrder.target 不同 */
  pendingVenueTarget?: BetSide;
  /** PM condition/market id，赛事离盘后仍可按官方 delay 参数续查 */
  pendingVenueConditionId?: string;
  /** 后台续查退避状态；刷新后继续生效 */
  pendingVenueNextPollAt?: number;
  pendingVenueAttempts?: number;
  /** delayed 原单确认后，是否允许转入补单；状态观察本身不受此值影响 */
  pendingVenueMakeUpEligible?: boolean;
  /** [changmen 扩展] 侧栏补单行运行时阶段（刷新后 placing/settling 会清空） */
  runtimePhase?: MakeupRuntimePhase;
}

/** [changmen 扩展] 补单队列项在订单列表中的运行时阶段 */
export type MakeupRuntimePhase
  = | "placing"
    | "settling"
    | "venue_pending"
    /** @deprecated 读旧持久化时映射为 venue_pending */
    | "pm_pending"
    | "rejected_retry";

/** [changmen 扩展] 用户手动取消的补单，侧栏 Link 组内保留展示 */
export interface LoseOrderCancelledRecord {
  betId: number;
  linkId: number;
  match: string;
  bet: string;
  target: BetSide;
  createAt: number;
  cancelledAt: number;
}

/** 对齐 A8 `Yt` */
export type OrderStatus
  = | "Pending"
    | "None"
    | "Win"
    | "Lose"
    | "Return"
    | "Reject"
    | string;
