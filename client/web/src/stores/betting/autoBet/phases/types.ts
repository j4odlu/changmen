import type { BetOption } from "@changmen/client-core/models/betOption";
import type { BetResult } from "@changmen/client-core/models/betResult";
import type { ViewBet, ViewMatch } from "@/models/match";
import type { PlatformAccount } from "@/models/platformAccount";
import type { ArbExecutionTrace } from "@/stores/betting/autoBet/arbExecutionTrace";
import type { UserConfig } from "@/types/userConfig";

export interface ArbBetReady {
  legA: BetOption;
  legB: BetOption;
  /** 本腿自动下单账号（9999 侧无） */
  accountA?: PlatformAccount;
  accountB?: PlatformAccount;
  /** 预检账号（9999 单边时本侧用 9999 账号仅预检） */
  checkAccountA?: PlatformAccount;
  checkAccountB?: PlatformAccount;
  implied: number;
  betBothLegs: boolean;
  /** 比例 9999 触发：本侧仅预检，对侧 live 腿真下单 */
  singleLegByRate: boolean;
  /** 9999 同图额度已在 prepare 阶段占位；失败时需要释放 */
  singleLeg9999MapReserved?: boolean;
  /** 9999 同图计数 key：前端 match:round + 场馆源盘口 key */
  singleLeg9999MapKeys?: string[];
  linkId: number;
  /** [changmen 扩展] 高利润加仓倍数；1 表示未触发 */
  stakeScale: number;
}

export interface ArbBetChecked extends ArbBetReady {
  waitSec: number;
  /** 本轮预检汇合完成时间（同端单调时钟，仅诊断）。 */
  precheckCompletedAt?: number;
  /** 扫描检测价，仅用于诊断；提交阶段不重检、不改价。 */
  scanOddsA: number;
  scanOddsB: number;
}

/**
 * place 阶段回传编排层的腿态（与场馆 settle 解耦）。
 * 场馆 filled/rejected/pending_confirm 仍由 settleArbLeg 判定。
 */
export type ArbLegPlaceOutcome =
  | "filled_pending_settle"
  /** PF：官网已收下挂单，成交/拒单待 confirm（须进 settle） */
  | "accepted_pending_confirm"
  | "api_failed"
  | "not_attempted";

/** place 成功且需进场馆 settle 的腿态（含 PF 挂单待确认） */
export function isArbLegPlaceNeedsSettle(placeOutcome: ArbLegPlaceOutcome): boolean {
  return placeOutcome === "filled_pending_settle"
    || placeOutcome === "accepted_pending_confirm";
}

export interface ArbBetPlaced extends ArbBetChecked {
  resultA?: BetResult;
  resultB?: BetResult;
  /** 有下单账号的腿必填；9999 无账号侧为 not_attempted */
  placeOutcomeA: ArbLegPlaceOutcome;
  placeOutcomeB: ArbLegPlaceOutcome;
}

/** 由 result + 是否发起下单推导 place 腿态 */
export function resolveArbLegPlaceOutcome(
  attempted: boolean,
  result?: BetResult,
): ArbLegPlaceOutcome {
  if (!attempted)
    return "not_attempted";
  if (!result?.success)
    return "api_failed";
  // pending：POST 已被场馆受理，但仍须后续确认；PM delayed 与 PF/RAY 类待确认同一编排语义
  if (result.pending)
    return "accepted_pending_confirm";
  // PF：API 成功 = 挂单受理，不是成交
  if (String(result.provider ?? "").trim().toLowerCase() === "predictfun")
    return "accepted_pending_confirm";
  return "filled_pending_settle";
}

export interface ArbBetAttemptParams {
  match: ViewMatch;
  bet: ViewBet;
  config: UserConfig;
  setMessage: (msg: string) => void;
  /** [changmen 扩展] 套利执行进度；由 prepare 在检测到腿后懒创建 */
  trace?: ArbExecutionTrace;
}
