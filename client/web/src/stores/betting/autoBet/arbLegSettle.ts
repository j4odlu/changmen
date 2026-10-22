import type { BetOption } from "@changmen/client-core/models/betOption";
import type { BetResult } from "@changmen/client-core/models/betResult";
import type { PlatformAccount } from "@/models/platformAccount";
import type { VenueOrder } from "@changmen/venue-browser/adapter/contract";
import { isPolymarketProvider, isPredictFunProvider } from "@changmen/shared/account_multiply";
import { confirmVenueBet } from "./confirmVenueBet";
import { persistPolymarketExecutionReject } from "@/stores/account/pmRejectOrder";
import { wait } from "@changmen/client-core/shared/wait";

export interface ArbLegSettleResult {
  orders: VenueOrder[];
  /** 未成交或 PM 已授权超时判拒（可补单） */
  rejected: boolean;
  /** 场馆仍待确认；不能作为补单锚腿或补单目标 */
  pendingConfirm: boolean;
}

export interface SettleArbLegOpts {
  rejectWaitSec?: number;
  /** [changmen 扩展] SaveOrder 直写最终 Link，缩短占位窗口 */
  pendingBindLinkId?: number;
  /** [changmen 扩展] PM 未成交落库用（stake/盘口） */
  betOption?: BetOption;
}

/** 本地一轮 timeout 后续跟。PF 挂单可能仍 OPEN；PM 由 settlement job 持续确认原单。 */
export const PENDING_CONFIRM_FOLLOW_ROUNDS = 6;
export const PENDING_CONFIRM_FOLLOW_GAP_MS = 2_000;

/** 套利单腿：场馆 resolveLegOutcome（wait → 拉单 / PM settle） */
export async function settleArbLeg(
  account: PlatformAccount,
  result?: BetResult,
  rejectWaitSecOrOpts?: number | SettleArbLegOpts,
): Promise<ArbLegSettleResult> {
  const opts: SettleArbLegOpts = typeof rejectWaitSecOrOpts === "number"
    || rejectWaitSecOrOpts == null
    ? { rejectWaitSec: rejectWaitSecOrOpts }
    : rejectWaitSecOrOpts;
  const confirmed = await confirmVenueBet(account, result, {
    rejectWaitSec: opts.rejectWaitSec,
    pendingBindLinkId: opts.pendingBindLinkId,
    pmConditionId: String(opts.betOption?.betId ?? "").trim() || undefined,
  });
  const { rejected } = confirmed;
  // PM 买入层已区分官方未成交和授权超时策略；两者均按现有拒单流程处理。
  if (rejected && result && isPolymarketProvider(account.provider)) {
    try {
      await persistPolymarketExecutionReject(account, result, "unfilled", {
        betOption: opts.betOption,
        linkId: opts.pendingBindLinkId,
      });
    }
    catch {
      /* 拒单落库失败不阻断 settle 回传 */
    }
  }
  return confirmed;
}

/**
 * 跟到已成交 / 未成交。
 * PF：timeout / 仍 pending → 续跟；耗尽仍未知则保持 pendingConfirm。
 * PM：核验耗尽按授权策略退出；已有成交证据但数量矛盾的异常保留续查。
 * 非 pending-confirm 馆：一轮即返回。
 */
export async function settleArbLegUntilTerminal(
  account: PlatformAccount,
  result?: BetResult,
  rejectWaitSecOrOpts?: number | SettleArbLegOpts,
): Promise<ArbLegSettleResult> {
  const needFollow = isPredictFunProvider(account.provider) && Boolean(result);
  const rounds = needFollow ? PENDING_CONFIRM_FOLLOW_ROUNDS : 1;
  let last: ArbLegSettleResult = { orders: [], rejected: false, pendingConfirm: false };
  for (let round = 0; round < rounds; round++) {
    last = await settleArbLeg(account, result, rejectWaitSecOrOpts);
    if (!last.pendingConfirm)
      return last;
    if (round < rounds - 1)
      await wait(PENDING_CONFIRM_FOLLOW_GAP_MS * (round + 1));
  }
  return last;
}
