import type { ObservationContext } from "@changmen/shared/order_observation";
import type { PmSubmission } from "@changmen/shared/pm_submission";
import type { LoseOrderRecord, MakeupRuntimePhase } from "../types/order";
import type { BetSide } from "./match";
import { validatePmSubmission } from "@changmen/shared/pm_submission";
import { toFixed } from "../shared/format";

function normalizeMakeupRuntimePhase(raw: unknown): MakeupRuntimePhase | undefined {
  const phase = String(raw ?? "").trim();
  if (!phase)
    return undefined;
  // 旧持久化 pm_pending → venue_pending
  if (phase === "pm_pending")
    return "venue_pending";
  if (
    phase === "placing"
    || phase === "settling"
    || phase === "venue_pending"
    || phase === "rejected_retry"
  ) {
    return phase;
  }
  return undefined;
}

/** 对齐 A8 bundle `eb`（补单队列项） */
export class LoseOrder implements LoseOrderRecord {
  observation?: ObservationContext;
  pendingObservation?: ObservationContext;
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
  pendingVenueSubmittedAt?: number;
  pendingPmSubmission?: PmSubmission;
  pendingVenueOdds?: number;
  pendingVenueBetMoney?: number;
  pendingVenueError?: string;
  pendingVenueOrderId?: string;
  pendingVenueAccountId?: number;
  pendingVenueRole?: "target" | "anchor";
  pendingVenueTarget?: BetSide;
  pendingVenueConditionId?: string;
  pendingVenueNextPollAt?: number;
  pendingVenueAttempts?: number;
  pendingVenueMakeUpEligible?: boolean;
  pendingRegularReceipt?: LoseOrderRecord["pendingRegularReceipt"];
  pendingVenueReceipt?: LoseOrderRecord["pendingVenueReceipt"];
  runtimePhase?: MakeupRuntimePhase;

  constructor(raw: Partial<LoseOrderRecord> & {
    pendingPmOrderId?: string;
    pendingPmAccountId?: number;
  }) {
    this.observation = raw.observation ? { ...raw.observation } : undefined;
    this.pendingObservation = raw.pendingObservation ? { ...raw.pendingObservation } : undefined;
    this.accountId = Number(raw.accountId) || 0;
    this.matchId = Number(raw.matchId) || 0;
    this.betId = Number(raw.betId) || 0;
    this.target = (raw.target as BetSide) || "Home";
    this.betMoney = Number(raw.betMoney) || 0;
    this.betOdds = Number(raw.betOdds) || 0;
    this.match = raw.match || "";
    this.bet = raw.bet || "";
    this.linkId = Number(raw.linkId) || 0;
    this.createAt = Number(raw.createAt) || Date.now();
    this.isCreateOrder = Boolean(raw.isCreateOrder);
    this.betCount = Number(raw.betCount) || 1;
    const pendingId = String(
      raw.pendingVenueOrderId ?? raw.pendingPmOrderId ?? "",
    ).trim();
    const regular = raw.pendingRegularReceipt;
    this.pendingRegularReceipt = regular && Number.isFinite(regular.checkAt) && regular.checkAt > 0
      ? { checkAt: regular.checkAt,
          ...(typeof regular.rejected === "boolean" ? { rejected: regular.rejected } : {}),
          ...(regular.bindOrderId ? { bindOrderId: String(regular.bindOrderId) } : {}) }
      : undefined;
    const hasPending = Boolean(pendingId || this.pendingRegularReceipt);
    this.pendingVenueOrderId = pendingId || undefined;
    this.pendingVenueSubmittedAt = hasPending ? Number(raw.pendingVenueSubmittedAt) || this.createAt : undefined;
    this.pendingVenueOdds = hasPending ? Number(raw.pendingVenueOdds) || undefined : undefined;
    this.pendingVenueBetMoney = hasPending ? Number(raw.pendingVenueBetMoney) || undefined : undefined;
    this.pendingVenueError = hasPending ? raw.pendingVenueError : undefined;
    const pendingAcc = Number(
      raw.pendingVenueAccountId ?? raw.pendingPmAccountId,
    );
    this.pendingVenueAccountId = hasPending && Number.isFinite(pendingAcc) && pendingAcc > 0
      ? pendingAcc
      : undefined;
    const receipt = raw.pendingVenueReceipt;
    this.pendingVenueReceipt = pendingId && receipt?.orderId === pendingId && receipt.accountId === pendingAcc
      && Number.isFinite(pendingAcc) && pendingAcc > 0 && typeof receipt.rejected === "boolean"
      ? { orderId: pendingId, accountId: pendingAcc, rejected: receipt.rejected,
          ...(receipt.bindOrderId ? { bindOrderId: String(receipt.bindOrderId) } : {}),
          ...(typeof receipt.message === "string" ? { message: receipt.message } : {}) }
      : undefined;
    this.pendingVenueRole = hasPending
      ? (raw.pendingVenueRole === "anchor" ? "anchor" : "target")
      : undefined;
    this.pendingPmSubmission = validatePmSubmission(raw.pendingPmSubmission, pendingId, pendingAcc) ?? undefined;
    this.pendingVenueTarget = hasPending && raw.pendingVenueTarget
      ? raw.pendingVenueTarget as BetSide
      : undefined;
    const conditionId = String(raw.pendingVenueConditionId ?? "").trim();
    this.pendingVenueConditionId = hasPending && conditionId ? conditionId : undefined;
    const nextPollAt = Number(raw.pendingVenueNextPollAt);
    this.pendingVenueNextPollAt = hasPending && Number.isFinite(nextPollAt) && nextPollAt > 0
      ? nextPollAt
      : undefined;
    const attempts = Number(raw.pendingVenueAttempts);
    this.pendingVenueAttempts = hasPending
      ? (Number.isFinite(attempts) && attempts > 0 ? Math.floor(attempts) : 0)
      : undefined;
    this.pendingVenueMakeUpEligible = hasPending
      ? raw.pendingVenueMakeUpEligible !== false
      : undefined;
    this.runtimePhase = normalizeMakeupRuntimePhase(raw.runtimePhase);
  }

  getBetMoney(odds: number) {
    if (!odds)
      return 0;
    return Math.round((this.betMoney * this.betOdds) / odds);
  }

  getOdds(makeProfit = 1.01) {
    if (this.isCreateOrder)
      return Number(this.betOdds);
    const p = makeProfit || 1.01;
    const implied = 1 / (1 / p - 1 / this.betOdds);
    return Number(toFixed(implied));
  }

  /** [changmen 扩展] 侧栏 Link 组合并展示的补单（含手动创建） */
  isLinkBoundMakeup(): boolean {
    return Number(this.linkId) !== 0;
  }

  toJSON(): LoseOrderRecord {
    return {
      ...(this.observation ? { observation: { ...this.observation } } : {}),
      ...(this.pendingObservation ? { pendingObservation: { ...this.pendingObservation } } : {}),
      accountId: this.accountId,
      matchId: this.matchId,
      betId: this.betId,
      target: this.target,
      betMoney: this.betMoney,
      betOdds: this.betOdds,
      match: this.match,
      bet: this.bet,
      linkId: this.linkId,
      createAt: this.createAt,
      isCreateOrder: this.isCreateOrder,
      betCount: this.betCount,
      ...(this.pendingVenueOrderId || this.pendingRegularReceipt
        ? {
            pendingRegularReceipt: this.pendingRegularReceipt ? { ...this.pendingRegularReceipt } : undefined,
            pendingVenueReceipt: this.pendingVenueReceipt ? { ...this.pendingVenueReceipt } : undefined,
            pendingVenueOrderId: this.pendingVenueOrderId,
            pendingPmSubmission: this.pendingPmSubmission,
            pendingVenueSubmittedAt: this.pendingVenueSubmittedAt,
            pendingVenueOdds: this.pendingVenueOdds,
            pendingVenueBetMoney: this.pendingVenueBetMoney,
            pendingVenueError: this.pendingVenueError,
            pendingVenueAccountId: this.pendingVenueAccountId,
            pendingVenueRole: this.pendingVenueRole ?? "target",
            pendingVenueTarget: this.pendingVenueTarget,
            pendingVenueConditionId: this.pendingVenueConditionId,
            pendingVenueNextPollAt: this.pendingVenueNextPollAt,
            pendingVenueAttempts: this.pendingVenueAttempts,
            pendingVenueMakeUpEligible: this.pendingVenueMakeUpEligible,
          }
        : {}),
      ...(this.runtimePhase ? { runtimePhase: this.runtimePhase } : {}),
    };
  }
}
