import type { LoseOrderRecord, MakeupRuntimePhase } from "../types/order";
import type { BetSide } from "./match";
import { toFixed } from "../shared/format";
import { validatePmSubmission, type PmSubmission } from "@changmen/shared/pm_submission";

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
  runtimePhase?: MakeupRuntimePhase;

  constructor(raw: Partial<LoseOrderRecord> & {
    pendingPmOrderId?: string;
    pendingPmAccountId?: number;
  }) {
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
    this.pendingVenueOrderId = pendingId || undefined;
    this.pendingVenueSubmittedAt = pendingId ? Number(raw.pendingVenueSubmittedAt) || this.createAt : undefined;
    this.pendingVenueOdds = pendingId ? Number(raw.pendingVenueOdds) || undefined : undefined;
    this.pendingVenueBetMoney = pendingId ? Number(raw.pendingVenueBetMoney) || undefined : undefined;
    this.pendingVenueError = pendingId ? raw.pendingVenueError : undefined;
    const pendingAcc = Number(
      raw.pendingVenueAccountId ?? raw.pendingPmAccountId,
    );
    this.pendingVenueAccountId = pendingId && Number.isFinite(pendingAcc) && pendingAcc > 0
      ? pendingAcc
      : undefined;
    this.pendingVenueRole = pendingId
      ? (raw.pendingVenueRole === "anchor" ? "anchor" : "target")
      : undefined;
    this.pendingPmSubmission = validatePmSubmission(raw.pendingPmSubmission, pendingId, pendingAcc) ?? undefined;
    this.pendingVenueTarget = pendingId && raw.pendingVenueTarget
      ? raw.pendingVenueTarget as BetSide
      : undefined;
    const conditionId = String(raw.pendingVenueConditionId ?? "").trim();
    this.pendingVenueConditionId = pendingId && conditionId ? conditionId : undefined;
    const nextPollAt = Number(raw.pendingVenueNextPollAt);
    this.pendingVenueNextPollAt = pendingId && Number.isFinite(nextPollAt) && nextPollAt > 0
      ? nextPollAt
      : undefined;
    const attempts = Number(raw.pendingVenueAttempts);
    this.pendingVenueAttempts = pendingId
      ? (Number.isFinite(attempts) && attempts > 0 ? Math.floor(attempts) : 0)
      : undefined;
    this.pendingVenueMakeUpEligible = pendingId
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
      ...(this.pendingVenueOrderId
        ? {
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
