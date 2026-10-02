import type {
  AdminOrderLogEntry,
  AdminOrderLogLegSection,
  AdminOrderLogLookup,
  AdminOrderLogOrder,
} from "@/types/admin";
import { Currency, defaultCurrencyForProvider, getExchange } from "@changmen/shared/currency";
import { attemptLogSegments } from "@/shared/adminOrderLogSegments";

export type AdminOrderDiagnosisTone = "neutral" | "success" | "warning" | "danger";

export interface AdminOrderExecutionStep {
  key: string;
  at: number;
  side: string;
  sideLabel: string;
  provider: string;
  accountLabel: string | null;
  isMakeUp: boolean;
  isRetry: boolean;
  isQueue: boolean;
  isQueueCancel: boolean;
  attemptType: string;
  odds: number | null;
  betMoney: number | null;
  check: AdminOrderLogEntry | null;
  bet: AdminOrderLogEntry | null;
  reject: AdminOrderLogEntry | null;
  queue: AdminOrderLogEntry | null;
  queueCancel: AdminOrderLogEntry | null;
  order: AdminOrderLogOrder | null;
  outcome: string;
  detail: string | null;
  tone: AdminOrderDiagnosisTone;
  oddsLogic: string;
  stakeLogic: string;
  rejectLogic: string | null;
}

export interface AdminOrderOrchestrationStage {
  key: string;
  at: number;
  title: string;
  tone: AdminOrderDiagnosisTone;
  decision: string;
  action: string;
  evidence: string[];
  homeNodes: AdminOrderOrchestrationNode[];
  awayNodes: AdminOrderOrchestrationNode[];
}

export interface AdminOrderOrchestrationNode {
  key: string;
  at: number;
  provider: string;
  title: string;
  summary: string;
  detail: string | null;
  tone: AdminOrderDiagnosisTone;
}

const LEGACY_LOG_NEAR_ORDER_MS = 15_000;
const TIMESTAMP_LINK_MIN = 1_000_000_000_000;

/**
 * 前端最后一道防串单保护。
 *
 * 新日志按 linkId / orderId 精确关联；旧日志没有唯一标识时，只保留紧邻当前
 * Link 创建时间或落库订单的记录。这样即使后端进程尚未重启、仍返回旧版宽松
 * 筛选结果，编排视图也不会混入同场比赛的其他套利轮次。
 */
export function filterAdminOrderDiagnosisLogs(
  payload: Pick<AdminOrderLogLookup, "link" | "orders" | "logs">,
): { related: AdminOrderLogEntry[]; filtered: AdminOrderLogEntry[] } {
  const link = Number(payload.link) || 0;
  const orderIds = new Set(payload.orders.map(order => String(order.orderId)).filter(Boolean));
  const anchors = payload.orders
    .map(order => Number(order.createAt) || 0)
    .filter(Boolean);
  const linkAt = Math.abs(link);
  if (linkAt >= TIMESTAMP_LINK_MIN)
    anchors.push(linkAt);

  const related: AdminOrderLogEntry[] = [];
  const filtered: AdminOrderLogEntry[] = [];
  for (const log of payload.logs) {
    const logLink = Number(log.linkId) || 0;
    const exactLink = logLink !== 0 && logLink === link;
    const exactOrder = Boolean(log.orderId && orderIds.has(String(log.orderId)));
    const nearCurrentAttempt = logLink === 0 && anchors.some(anchor =>
      Math.abs(Number(log.createAt) - anchor) <= LEGACY_LOG_NEAR_ORDER_MS,
    );
    const keep = logLink !== 0 ? exactLink : exactOrder || nearCurrentAttempt;
    (keep ? related : filtered).push(log);
  }
  return { related, filtered };
}

function fmt(n: number, digits = 3) {
  return Number(n.toFixed(digits)).toString();
}

function planStakeCny(step: Pick<AdminOrderExecutionStep, "provider" | "betMoney" | "check">) {
  const loggedPlan = Number(step.check?.planBetMoney);
  if (loggedPlan > 0)
    return loggedPlan;
  const amount = Number(step.betMoney) || 0;
  return defaultCurrencyForProvider(step.provider) === Currency.USDT
    ? amount * getExchange(Currency.USDT)
    : amount;
}

function stakeConversionText(step: AdminOrderExecutionStep) {
  const actual = venueStakeText(step.provider, step.betMoney);
  const plan = Number(step.check?.planBetMoney);
  if (!(plan > 0)) {
    return defaultCurrencyForProvider(step.provider) === Currency.USDT
      ? `按历史默认汇率 1U=¥${getExchange(Currency.USDT)}，提交 ${actual}`
      : `取整后提交 ${actual}`;
  }
  const exchange = Number(step.check?.stakeExchange) || 1;
  const rate = Number(step.check?.stakeRate) || 1;
  const details = [
    exchange !== 1 ? `汇率 ${fmt(exchange, 3)}` : "",
    Math.abs(rate - 1) > 0.001 ? `账号比例 ${fmt(rate, 3)}` : "",
  ].filter(Boolean).join("、");
  return `计划金额 ¥${fmt(plan, 2)}${details ? `，经${details}` : ""}，场馆提交 ${actual}`;
}

function venueStakeText(provider: string, amount: number | null) {
  const n = Number(amount) || 0;
  const currency = defaultCurrencyForProvider(provider);
  if (currency === Currency.USDT) {
    const unit = provider === "Polymarket" ? "USDC" : "USDT";
    return `${fmt(n, 2)} ${unit}（约 ¥${fmt(n * getExchange(currency), 0)}）`;
  }
  return `¥${fmt(n, 0)}`;
}

function elapsedText(ms: number) {
  if (ms < 1_000)
    return `${Math.max(0, Math.round(ms))}ms`;
  return `${fmt(ms / 1_000, 1)}秒`;
}

function statusText(status: string | null | undefined) {
  const s = String(status || "").toLowerCase();
  if (s === "win")
    return "已结算：赢";
  if (s === "lose")
    return "已结算：输";
  if (s === "reject")
    return "场馆拒单";
  if (s === "return")
    return "已退回";
  if (s === "pending" || s === "none")
    return "场馆待确认";
  return status ? `场馆状态：${status}` : "";
}

/** [changmen 扩展] 接口受理、订单存在、成交确认、比赛结算分别判断。 */
function confirmation(step: AdminOrderExecutionStep): "rejected" | "returned" | "filled" | "pending" {
  const status = String(step.order?.status || "").toLowerCase();
  if (status === "reject" || step.reject?.settlement === "unfilled")
    return "rejected";
  if (status === "return")
    return "returned";
  if (status === "win" || status === "lose" || step.reject?.settlement === "filled")
    return "filled";
  return "pending";
}

export interface AdminOrderDiagnosisContext {
  linkType?: string;
  truncated?: boolean;
}

export function adminOrderEvidenceIssues(steps: AdminOrderExecutionStep[], context: AdminOrderDiagnosisContext = {}): string[] {
  const issues: string[] = [];
  const initial = steps.filter(step => !step.isMakeUp && !step.isRetry && !step.isQueue && !step.isQueueCancel);
  if (!steps.length)
    issues.push("未找到相关诊断日志");
  if (context.truncated)
    issues.push("日志已截断");
  if (context.linkType !== "单边" && !(initial.some(step => step.side === "Home") && initial.some(step => step.side === "Away")))
    issues.push("初始双腿证据不足");
  if (steps.some(step => !step.isQueue && !step.isQueueCancel && (!step.check || (!step.bet && !step.check.checkError))))
    issues.push("缺少预检或下单结果日志");
  if (steps.some(step => step.bet?.success === true && !step.order))
    issues.push("接口受理记录缺少对应落库订单");
  if (steps.some(step => confirmation(step) === "returned"))
    issues.push("存在已退回订单，需核对对冲是否仍成立");
  if (steps.some(step => String(step.order?.status || "").toLowerCase() === "reject" && !step.reject?.observedAt && !step.reject?.createAt))
    issues.push("拒单发现时间缺失");
  if (steps.some(step => !step.isQueue && !step.isQueueCancel && step.bet?.success !== false && !step.check?.checkError && confirmation(step) === "pending"))
    issues.push("存在待确认的场馆结果");
  return issues;
}

function outcomeFor(
  check: AdminOrderLogEntry | null,
  bet: AdminOrderLogEntry | null,
  reject: AdminOrderLogEntry | null,
  order: AdminOrderLogOrder | null,
): Pick<AdminOrderExecutionStep, "outcome" | "detail" | "tone"> {
  if (bet?.success === false) {
    return {
      outcome: "下单失败",
      detail: bet.message || check?.checkError || null,
      tone: "danger",
    };
  }

  if (reject?.settlement === "unfilled") {
    return {
      outcome: bet?.success === true ? "接口受理 → 场馆拒单" : "场馆拒单",
      detail: reject.rejectReason || null,
      tone: "danger",
    };
  }

  const finalStatus = statusText(order?.status);
  if (String(order?.status || "").toLowerCase() === "reject") {
    return {
      outcome: bet?.success === true ? "接口受理 → 场馆拒单" : "场馆拒单",
      detail: bet?.message || null,
      tone: "danger",
    };
  }
  if (order) {
    const lower = String(order.status || "").toLowerCase();
    return {
      outcome: bet?.success === true ? `接口受理 → ${finalStatus}` : finalStatus,
      detail: bet?.message || null,
      tone: lower === "win" ? "success" : lower === "lose" ? "danger" : "warning",
    };
  }
  if (bet?.success === true) {
    if (reject?.settlement === "filled")
      return { outcome: "接口受理 → 确认成交 · 未找到落库订单", detail: bet.message || null, tone: "warning" };
    return {
      outcome: "接口受理 · 未找到场馆订单",
      detail: bet.message || null,
      tone: "warning",
    };
  }
  if (check?.checkError) {
    return { outcome: "预检失败", detail: check.checkError, tone: "danger" };
  }
  return { outcome: "仅有预检，未见下单结果", detail: null, tone: "warning" };
}

function segmentMatchesOrder(
  provider: string | null | undefined,
  logs: AdminOrderLogEntry[],
  at: number,
  order: AdminOrderLogOrder | null,
) {
  if (!order || (provider && order.provider && provider !== order.provider))
    return false;
  if (logs.some(log => String(log.orderId || "") === String(order.orderId)))
    return true;
  // inferred matchedOrderId 可能把同平台早先失败尝试挂到后来的补单；时间过远时不共享终态。
  return Math.abs(Number(at) - Number(order.createAt)) <= 15_000;
}

/** 把主客队分栏还原成按时间排序的真实执行链。 */
export function buildAdminOrderExecutionSteps(
  legs: AdminOrderLogLegSection[],
): AdminOrderExecutionStep[] {
  const steps: AdminOrderExecutionStep[] = [];

  for (const leg of legs) {
    for (const attempt of leg.attempts) {
      const segments = attemptLogSegments(attempt);
      if (!segments.length && attempt.order) {
        const result = outcomeFor(null, null, null, attempt.order);
        steps.push({
          key: `order:${attempt.order.orderId}`,
          at: attempt.order.createAt,
          side: leg.side,
          sideLabel: leg.label,
          provider: attempt.order.provider,
          accountLabel: null,
          isMakeUp: false,
          isRetry: false,
          isQueue: false,
          isQueueCancel: false,
          attemptType: "initial",
          odds: attempt.order.odds || null,
          betMoney: attempt.order.betMoney || null,
          check: null,
          bet: null,
          reject: null,
          queue: null,
          queueCancel: null,
          order: attempt.order,
          oddsLogic: "订单缺少对应预检日志，无法还原当时赔率来源",
          stakeLogic: "订单缺少对应预检日志，无法还原金额公式",
          rejectLogic: String(attempt.order.status || "").toLowerCase() === "reject"
            ? "场馆最终状态为拒单；旧日志未记录发现时间与拒因"
            : null,
          ...result,
        });
        continue;
      }

      for (const segment of segments) {
        const check = segment.logs.find(log => log.kind === "check") ?? null;
        const bet = [...segment.logs].reverse().find(log => log.kind === "bet") ?? null;
        const reject = [...segment.logs].reverse().find(log => log.kind === "reject") ?? null;
        const queue = segment.logs.find(log => log.kind === "makeup_queue") ?? null;
        const queueCancel = segment.logs.find(log => log.kind === "makeup_cancel") ?? null;
        const attemptType = String(
          check?.attemptType || bet?.attemptType || reject?.attemptType || queue?.attemptType || queueCancel?.attemptType || "",
        );
        const isQueue = Boolean(queue || attemptType === "makeup_queue");
        const isQueueCancel = Boolean(queueCancel || attemptType === "makeup_cancel");
        const isMakeUp = Boolean(!isQueue && !isQueueCancel && (attemptType === "makeup" || segment.isMakeUp || check?.loseOrder));
        const isRetry = Boolean(attemptType === "retry");
        const provider = String(segment.provider || check?.provider || bet?.provider || attempt.order?.provider || (isQueue || isQueueCancel ? "系统" : "未知"));
        const at = Number(check?.createAt || bet?.createAt || queue?.createAt || queueCancel?.createAt || attempt.order?.createAt) || 0;
        const order = segmentMatchesOrder(provider, segment.logs, at, attempt.order) ? attempt.order : null;
        const result = isQueue
          ? { outcome: "已加入补单队列（尚未下单）", detail: null, tone: "warning" as const }
          : isQueueCancel
            ? { outcome: "补单队列已取消（未继续下单）", detail: queueCancel?.message || null, tone: "success" as const }
            : outcomeFor(check, bet, reject, order);
        const odds = Number(check?.newOdds ?? check?.odds ?? queue?.failedLegOdds ?? order?.odds) || null;
        const betMoney = Number(check?.betMoney ?? queue?.betMoney ?? order?.betMoney) || null;
        steps.push({
          key: `${attempt.key}:${segment.key}`,
          at,
          side: leg.side,
          sideLabel: leg.label,
          provider,
          accountLabel: segment.accountLabel || check?.accountLabel || bet?.accountLabel || null,
          isMakeUp,
          isRetry,
          isQueue,
          isQueueCancel,
          attemptType: attemptType || (isMakeUp ? "makeup" : isQueue ? "makeup_queue" : isQueueCancel ? "makeup_cancel" : "initial"),
          odds,
          betMoney,
          check,
          bet,
          reject,
          queue,
          queueCancel,
          order,
          oddsLogic: isQueue
            ? `失败腿最后赔率 ${queue?.failedLegOdds || "—"}；入队时尚未产生补单赔率`
            : isQueueCancel
              ? "锚腿确认拒单后撤销队列，未产生新的补单赔率"
              : isMakeUp
                ? `补单赔率 ${odds || "—"} 来自补单执行时的场馆实时盘口，不是由公式计算`
                : isRetry
                  ? `重试赔率 ${odds || "—"} 来自失败后再次预检的实时盘口`
                  : `下单赔率 ${odds || "—"} 来自本轮预检实时盘口`,
          stakeLogic: "等待同组订单计算",
          rejectLogic: null,
          ...result,
        });
      }
    }
  }

  steps.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));

  // 老日志没有 attemptType。若同一方向失败后紧接着再次预检，可安全还原为即时重试。
  const previousBySide = new Map<string, AdminOrderExecutionStep>();
  for (const step of steps) {
    const previous = previousBySide.get(step.side);
    const previousFailed = previous && (
      previous.bet?.success === false
      || Boolean(previous.check?.checkError)
      || String(previous.order?.status || "").toLowerCase() === "reject"
      || previous.reject?.settlement === "unfilled"
    );
    if (!step.isMakeUp && !step.isQueue && !step.isQueueCancel && !step.isRetry && !step.order && step.check && previousFailed
      && step.at - previous.at >= 0 && step.at - previous.at <= LEGACY_LOG_NEAR_ORDER_MS) {
      step.isRetry = true;
      step.attemptType = "retry";
      step.oddsLogic = `重试赔率 ${step.odds || "—"} 来自失败后再次预检的实时盘口`;
    }
    if (!step.isQueue)
      previousBySide.set(step.side, step);
  }

  const originals = steps.filter(step => !step.isMakeUp && !step.isRetry && !step.isQueue && step.odds && step.betMoney);
  const initialBySide = new Map<string, AdminOrderExecutionStep>();
  for (const step of originals) {
    if (!initialBySide.has(step.side))
      initialBySide.set(step.side, step);
  }
  const initialPair = [...initialBySide.values()];
  const base = [...initialPair].sort((a, b) => Number(a.odds) - Number(b.odds))[0];
  if (base?.odds && base.betMoney) {
    const baseCny = planStakeCny(base);
    for (const step of initialPair) {
      if (!step.odds || !step.betMoney)
        continue;
      if (step === base) {
        step.stakeLogic = `低赔腿作为基准注码：${stakeConversionText(step)}`;
        continue;
      }
      const calculatedCny = (baseCny * Number(base.odds)) / Number(step.odds);
      step.stakeLogic = `对冲金额 = ¥${fmt(baseCny, 0)} × ${base.odds} ÷ ${step.odds} = ¥${fmt(calculatedCny, 2)}；${stakeConversionText(step)}`;
    }
  }

  for (const step of steps.filter(row => row.isMakeUp || row.isRetry)) {
    const anchor = [...steps]
      .filter(row => !row.isMakeUp && !row.isRetry && !row.isQueue
        && row.at < step.at
        && row.side !== step.side
        && row.bet?.success === true
        && row.odds
        && row.betMoney)
      .sort((a, b) => b.at - a.at)[0];
    if (anchor?.odds && anchor.betMoney && step.odds && step.betMoney) {
      const anchorCny = planStakeCny(anchor);
      const calculatedCny = (anchorCny * Number(anchor.odds)) / Number(step.odds);
      const label = step.isRetry ? "即时重试金额" : "补单金额";
      step.stakeLogic = `${label} = 锚腿 ¥${fmt(anchorCny, 0)} × ${anchor.odds} ÷ 实时赔率 ${step.odds} = ¥${fmt(calculatedCny, 2)}；${stakeConversionText(step)}`;
    }
    else {
      step.stakeLogic = `${step.isRetry ? "即时重试" : "补单"}提交 ${venueStakeText(step.provider, step.betMoney)}；缺少锚腿日志，无法完整还原公式`;
    }
  }

  for (const step of steps.filter(row => row.isQueue)) {
    const queue = step.queue;
    const anchorMoney = Number(queue?.betMoney ?? step.betMoney) || 0;
    const anchorOdds = Number(queue?.odds) || 0;
    step.stakeLogic = anchorMoney && anchorOdds
      ? `入队锚腿 ¥${fmt(anchorMoney, 0)}@${anchorOdds}；真正执行时再按“锚腿金额 × 锚腿赔率 ÷ 补单实时赔率”计算`
      : "已创建补单任务；真正执行时才按场馆实时赔率计算补单金额";
  }

  for (const step of steps) {
    if (step.bet?.success === false) {
      const delay = step.check && step.bet
        ? Math.max(0, step.bet.createAt - step.check.createAt)
        : null;
      step.rejectLogic = `即时失败：接口未受理${delay == null ? "" : `，预检到失败间隔 ${elapsedText(delay)}`}；原因：${step.bet.message || step.check?.checkError || "场馆未返回原因"}`;
      continue;
    }
    if (
      String(step.order?.status || "").toLowerCase() !== "reject"
      && step.reject?.settlement !== "unfilled"
    ) {
      continue;
    }
    const rejectLog = step.reject;
    const delayMs = Number(rejectLog?.rejectDelayMs);
    const reason = rejectLog?.rejectReason || "场馆最终状态为 Reject，但未返回具体拒因";
    step.rejectLogic = step.bet?.success === true
      ? `事后拒单：下单接口先受理，随后场馆订单变为拒单${delayMs > 0 ? `，间隔 ${elapsedText(delayMs)}` : "；旧日志未记录准确发现时间，无法计算间隔"}；原因：${reason}`
      : `场馆拒单；原因：${reason}`;
  }

  return steps;
}

export function buildAdminOrderDiagnosisSummary(
  steps: AdminOrderExecutionStep[],
  totalProfit: number,
  context: AdminOrderDiagnosisContext = {},
): { text: string; tone: AdminOrderDiagnosisTone } {
  const originals = steps.filter(step => !step.isMakeUp && !step.isRetry && !step.isQueue && !step.isQueueCancel);
  const apiFailures = originals.filter(step => step.bet?.success === false).length;
  const precheckFailures = originals.filter(step => Boolean(step.check?.checkError) && !step.bet).length;
  const venueRejects = originals.filter(step =>
    String(step.order?.status || "").toLowerCase() === "reject"
    || step.reject?.settlement === "unfilled",
  ).length;
  const makeups = steps.filter(step => step.isMakeUp);
  const submittedMakeups = makeups.filter(step => step.bet || step.order).length;
  const blockedMakeups = makeups.filter(step => !step.bet && !step.order && Boolean(step.check?.checkError)).length;
  const incompleteMakeups = makeups.filter(step => !step.bet && !step.order && !step.check?.checkError).length;
  const retries = steps.filter(step => step.isRetry).length;
  const followupFailures = steps.filter(step => (step.isRetry || step.isMakeUp) && (step.bet?.success === false || confirmation(step) === "rejected")).length;
  const queues = steps.filter(step => step.isQueue).length;
  const canceledQueues = steps.filter(step => step.isQueueCancel).length;
  const parts: string[] = [];
  const issues = adminOrderEvidenceIssues(steps, context);
  const single = context.linkType === "单边";

  if (apiFailures || venueRejects || precheckFailures) {
    const failures = [
      apiFailures ? `${apiFailures} 腿下单失败` : "",
      venueRejects ? `${venueRejects} 笔场馆拒单` : "",
      precheckFailures ? `${precheckFailures} 腿预检失败` : "",
    ].filter(Boolean).join("，");
    parts.push(`${single ? "单边下单异常" : "首轮套利执行未完整成交"}：${failures}`);
  }
  else {
    parts.push(issues.length ? "证据不足，无法确认本轮完整执行结果" : single ? "单边订单未发现失败或拒单" : "原始套利两腿未发现失败或拒单");
  }
  if (retries)
    parts.push(`即时重试 ${retries} 次`);
  if (queues)
    parts.push(`创建 ${queues} 个补单队列`);
  if (canceledQueues)
    parts.push(`锚腿拒单后取消 ${canceledQueues} 个补单队列`);
  if (submittedMakeups)
    parts.push(`实际提交 ${submittedMakeups} 次补单`);
  if (followupFailures)
    parts.push(`重试或补单中 ${followupFailures} 次失败或拒单`);
  if (blockedMakeups)
    parts.push(`补单预检拦截 ${blockedMakeups} 次`);
  if (incompleteMakeups)
    parts.push(`另有 ${incompleteMakeups} 次补单仅记录到预检`);
  if (findStaleMakeupQueue(steps))
    parts.push("检测到锚腿拒单后补单队列仍继续执行");
  const sign = totalProfit > 0 ? "+" : "";
  const orders = steps.filter(step => step.order);
  const finalProfit = orders.length > 0
    && orders.every(step => ["win", "lose", "reject", "return"].includes(String(step.order?.status || "").toLowerCase()))
    && !steps.some(step => step.bet?.success === true && !step.order);
  parts.push(`${finalProfit && !context.truncated ? "最终" : "当前已记录"} Link 盈亏 ¥${sign}${Math.floor(totalProfit).toLocaleString()}`);
  if (issues.length)
    parts.push(issues.join("，"));

  return {
    text: parts.join("；"),
    tone: totalProfit < 0 || apiFailures > 0 || venueRejects > 0 || precheckFailures > 0
      || steps.some(step => step.bet?.success === false || confirmation(step) === "rejected")
      || Boolean(findStaleMakeupQueue(steps))
      ? "danger"
      : issues.length
        ? "warning"
        : totalProfit > 0
          ? "success"
          : "neutral",
  };
}

function stepRejectedAt(step: AdminOrderExecutionStep): number | null {
  if (
    step.reject?.settlement !== "unfilled"
    && String(step.order?.status || "").toLowerCase() !== "reject"
  ) {
    return null;
  }
  return Number(
    step.reject?.observedAt
    || step.reject?.createAt,
  ) || null;
}

/** 补单已入队后，原锚腿又确认拒单，但队列仍产生后续补单尝试。 */
function findStaleMakeupQueue(steps: AdminOrderExecutionStep[]) {
  const originals = steps.filter(step => !step.isMakeUp && !step.isRetry && !step.isQueue && !step.isQueueCancel);
  const makeups = steps.filter(step => step.isMakeUp);
  for (const queue of steps.filter(step => step.isQueue)) {
    const anchor = originals
      .filter(step => step.side !== queue.side && step.at <= queue.at && step.bet?.success === true)
      .sort((a, b) => b.at - a.at)[0];
    if (!anchor)
      continue;
    const rejectedAt = stepRejectedAt(anchor);
    if (rejectedAt && makeups.some(step => step.side === queue.side && step.at > rejectedAt))
      return { queue, anchor, rejectedAt };
  }
  return null;
}

function stepEvidence(step: AdminOrderExecutionStep) {
  const market = [step.sideLabel, step.provider, step.odds ? `@${step.odds}` : "", step.betMoney ? `金额 ${step.betMoney}` : ""]
    .filter(Boolean)
    .join(" · ");
  return `${market}：${step.outcome}${step.detail ? `（${step.detail}）` : ""}`;
}

function stageNodes(
  rows: AdminOrderExecutionStep[],
  title: (step: AdminOrderExecutionStep) => string,
  detail: (step: AdminOrderExecutionStep) => string | null,
  tone: (step: AdminOrderExecutionStep) => AdminOrderDiagnosisTone = step => step.tone,
) {
  const toNode = (step: AdminOrderExecutionStep): AdminOrderOrchestrationNode => ({
    key: step.key,
    at: step.at,
    provider: step.provider,
    title: title(step),
    summary: [step.odds ? `赔率 ${step.odds}` : "", step.betMoney ? `金额 ${step.betMoney}` : ""]
      .filter(Boolean)
      .join(" · ") || step.outcome,
    detail: detail(step),
    tone: tone(step),
  });
  return {
    homeNodes: rows.filter(step => step.side !== "Away").map(toNode),
    awayNodes: rows.filter(step => step.side === "Away").map(toNode),
  };
}

/** 将场馆级日志重组成编排器的“判断 → 动作 → 结果”流程。 */
export function buildAdminOrderOrchestrationStages(
  steps: AdminOrderExecutionStep[],
  totalProfit: number,
  context: AdminOrderDiagnosisContext = {},
): AdminOrderOrchestrationStage[] {
  if (!steps.length)
    return [];

  const stages: AdminOrderOrchestrationStage[] = [];
  const initial = steps.filter(step => !step.isRetry && !step.isQueue && !step.isQueueCancel && !step.isMakeUp);
  const retries = steps.filter(step => step.isRetry);
  const queues = steps.filter(step => step.isQueue);
  const canceledQueues = steps.filter(step => step.isQueueCancel);
  const makeups = steps.filter(step => step.isMakeUp);
  const staleQueue = findStaleMakeupQueue(steps);
  const firstAt = Math.min(...steps.map(step => step.at).filter(Boolean));
  const lastAt = Math.max(...steps.map(step => step.at).filter(Boolean));

  if (initial.length) {
    const nodes = stageNodes(initial, () => "计划腿", step => step.stakeLogic, () => "neutral");
    stages.push({
      key: "plan",
      at: firstAt,
      title: context.linkType === "单边" ? "单边下单方案" : "生成对冲方案",
      tone: "neutral",
      decision: context.linkType === "单边"
        ? "本轮为单边订单，按单腿证据还原执行过程。"
        : initial.some(step => step.side === "Home") && initial.some(step => step.side === "Away")
          ? "识别到两条相反方向的套利腿，编排器生成同一 Link 的对冲方案。"
          : "仅还原到一条初始腿，历史日志不足以完整重建双腿方案。",
      action: "根据已有日志还原方向、场馆、赔率和金额；金额公式为推算，须结合预检记录核对。",
      evidence: initial.map(step => `${step.sideLabel} ${step.provider}：${step.oddsLogic}；${step.stakeLogic}`),
      ...nodes,
    });
  }

  const checked = initial.filter(step => step.check);
  if (checked.length) {
    const failed = checked.filter(step => Boolean(step.check?.checkError));
    const allCovered = context.linkType === "单边" ? checked.length > 0 : checked.some(step => step.side === "Home") && checked.some(step => step.side === "Away");
    const nodes = stageNodes(
      checked,
      step => step.check?.checkError ? "预检失败" : "预检通过",
      step => step.check?.checkError || step.oddsLogic,
      step => step.check?.checkError ? "danger" : "success",
    );
    stages.push({
      key: "precheck",
      at: Math.min(...checked.map(step => step.check?.createAt || step.at)),
      title: context.linkType === "单边" ? "单腿预检" : "双腿预检",
      tone: failed.length ? "danger" : allCovered ? "success" : "warning",
      decision: failed.length
        ? `${failed.length} 腿预检未通过，按编排规则不应继续首轮下单。`
        : allCovered
          ? `${context.linkType === "单边" ? "单腿" : "双腿"}预检通过，已有日志未记录预检错误。`
          : "现有日志未覆盖完整双腿预检，无法确认放行条件是否全部满足。",
      action: failed.length ? "停止首轮下单，保留失败原因。" : "复用预检锁定的盘口数据发起首轮下单。",
      evidence: checked.map(step => `${step.sideLabel} ${step.provider}：${step.check?.checkError || `通过，${step.odds}@${step.betMoney}`}`),
      ...nodes,
    });
  }

  const placed = initial.filter(step => step.bet);
  if (placed.length) {
    const accepted = placed.filter(step => step.bet?.success === true);
    const failed = placed.filter(step => step.bet?.success === false);
    const split = accepted.length > 0 && failed.length > 0;
    const nodes = stageNodes(
      placed,
      step => step.bet?.success === true ? "接口受理" : "下单失败",
      step => step.bet?.message || step.rejectLogic,
      step => step.bet?.success === true ? "success" : "danger",
    );
    stages.push({
      key: "place",
      at: Math.min(...placed.map(step => step.bet?.createAt || step.at)),
      title: "首轮下单",
      tone: split || failed.length ? "danger" : context.linkType === "单边" || (accepted.some(step => step.side === "Home") && accepted.some(step => step.side === "Away")) ? "success" : "warning",
      decision: split
        ? "一腿接口已受理、另一腿下单失败，完整套利没有同时成立，产生单腿敞口。"
        : failed.length
          ? `${failed.length} 腿下单失败，编排器不会把本轮判定为完整套利。`
          : context.linkType === "单边"
            ? "单腿接口已受理，仍需确认场馆结果。"
            : accepted.some(step => step.side === "Home") && accepted.some(step => step.side === "Away")
              ? "两腿接口均已受理，编排器继续等待场馆终态，尚不能仅凭接口成功认定成交。"
              : "仅找到部分下单结果，缺少另一方向的受理证据。",
      action: split ? "锁定成功腿作为锚腿，并对失败腿启动即时重试。" : "进入场馆终态确认。",
      evidence: placed.map(stepEvidence),
      ...nodes,
    });
  }

  const settled = initial.filter(step => step.order || step.reject || step.bet?.success === true);
  if (settled.length) {
    const rejected = settled.filter(step => confirmation(step) === "rejected");
    const filled = settled.filter(step => confirmation(step) === "filled");
    const returned = settled.filter(step => confirmation(step) === "returned");
    const pending = settled.length - rejected.length - filled.length - returned.length;
    const nodes = stageNodes(
      settled,
      step => ({ filled: "确认成交", rejected: "确认拒单", returned: "已退回", pending: "仍待确认" })[confirmation(step)],
      step => step.rejectLogic || step.outcome,
      step => confirmation(step) === "rejected" ? "danger" : confirmation(step) === "filled" ? "success" : "warning",
    );
    stages.push({
      key: "settle",
      at: Math.max(...settled.map(step => Math.max(
        step.reject?.observedAt || step.reject?.createAt || 0,
        step.bet?.createAt || 0,
        step.order?.createAt || 0,
        step.at,
      ))),
      title: "场馆终态确认",
      tone: rejected.length ? "danger" : pending || returned.length ? "warning" : "success",
      decision: `终态检查得到：${filled.length} 腿确认成交，${rejected.length} 腿确认拒单${returned.length ? `，${returned.length} 腿已退回` : ""}${pending ? `，${pending} 腿仍待确认` : ""}。`,
      action: rejected.length ? "将确认拒单腿交给风险处置；仅以已成交腿作为补单锚腿。" : "记录场馆订单及确认耗时。",
      evidence: settled.map(step => `${stepEvidence(step)}${step.rejectLogic ? `；${step.rejectLogic}` : ""}`),
      ...nodes,
    });
  }

  if (retries.length) {
    const succeeded = retries.filter(step => step.bet?.success === true && !step.rejectLogic).length;
    const nodes = stageNodes(retries, () => "即时重试", step => `${step.outcome}；${step.stakeLogic}`);
    stages.push({
      key: "retry",
      at: Math.min(...retries.map(step => step.at)),
      title: "即时换腿重试",
      tone: succeeded ? "success" : "danger",
      decision: `首轮出现单腿敞口，编排器对失败方向执行 ${retries.length} 次即时重试。`,
      action: succeeded ? "重试已受理，继续确认新订单终态。" : "即时重试仍未成交，转入补单判断。",
      evidence: retries.map(step => `${stepEvidence(step)}；${step.stakeLogic}`),
      ...nodes,
    });
  }

  if (queues.length || canceledQueues.length) {
    const queueRows = [...queues, ...canceledQueues];
    const nodes = stageNodes(
      queueRows,
      step => step.isQueueCancel ? "补单已取消" : "补单入队",
      step => step.isQueueCancel ? step.queueCancel?.message || step.stakeLogic : step.stakeLogic,
      step => step.isQueueCancel ? "success" : "warning",
    );
    // [changmen 扩展] 旧事件没有 queueId，按方向和时序一对一核对，不能只比较数量。
    const remaining = [...queues].sort((a, b) => a.at - b.at);
    for (const cancel of [...canceledQueues].sort((a, b) => a.at - b.at)) {
      const index = remaining.findIndex(queue => queue.side === cancel.side && queue.at <= cancel.at);
      if (index >= 0)
        remaining.splice(index, 1);
    }
    const fullyCanceled = queues.length > 0 && remaining.length === 0;
    stages.push({
      key: "queue",
      at: Math.min(...queueRows.map(step => step.at)),
      title: "补单决策与队列状态",
      tone: staleQueue ? "danger" : fullyCanceled ? "success" : "warning",
      decision: staleQueue
        ? `编排器创建 ${queues.length} 个补单任务，但锚腿随后确认拒单，补单已失去有效成交锚点。`
        : fullyCanceled
          ? `编排器创建 ${queues.length} 个补单任务；锚腿随后确认拒单，相关补单队列已全部取消。`
          : `即时处置未消除敞口，编排器创建 ${queues.length} 个补单任务。`,
      action: staleQueue
        ? "锚腿拒单后队列仍未撤销，后续补单不再是有效对冲；这是需要修复的编排异常。"
        : fullyCanceled
          ? "确认已无成交敞口后停止补单，没有继续向场馆提交补单。"
          : "此时只代表进入补单队列；实际赔率和金额要等补单执行时重新计算。",
      evidence: queueRows.map(step => `${step.sideLabel}：${step.outcome}${step.detail ? `；${step.detail}` : ""}`),
      ...nodes,
    });
  }

  if (makeups.length) {
    const submitted = makeups.filter(step => step.bet || step.order);
    const blocked = makeups.filter(step => !step.bet && !step.order && Boolean(step.check?.checkError));
    const incomplete = makeups.filter(step => !step.bet && !step.order && !step.check?.checkError);
    const failures = submitted.filter(step => step.bet?.success === false || step.rejectLogic).length;
    const nodes = stageNodes(makeups, () => "补单执行", step => `${step.outcome}；${step.stakeLogic}`);
    stages.push({
      key: "makeup",
      at: Math.min(...makeups.map(step => step.at)),
      title: "补单执行",
      tone: staleQueue || failures || incomplete.length ? "danger" : blocked.length ? "warning" : "success",
      decision: `${[
        `补单共预检 ${makeups.length} 轮`,
        `实际提交 ${submitted.length} 轮`,
        blocked.length ? `${blocked.length} 轮被预检拦截` : "",
        incomplete.length ? `${incomplete.length} 轮缺少下单结果日志` : "",
        failures ? `${failures} 轮提交后未成功` : "",
      ].filter(Boolean).join("，")}。`,
      action: staleQueue
        ? "这些补单发生在锚腿确认拒单之后，应标记为无锚补单，而不是正常对冲。"
        : "按锚腿敞口和补单时实时赔率重新计算金额，并再次检查场馆终态。",
      evidence: makeups.map(step => `${stepEvidence(step)}；${step.stakeLogic}`),
      ...nodes,
    });
  }

  const summary = buildAdminOrderDiagnosisSummary(steps, totalProfit, context);
  stages.push({
    key: "final",
    at: lastAt,
    title: "编排收尾",
    tone: summary.tone,
    decision: summary.text,
    action: "汇总同一 Link 下已记录盈亏；待确认、未结算或日志缺失时继续核查，不能判定编排已完成。",
    evidence: [`当前已记录 Link 盈亏 ¥${totalProfit > 0 ? "+" : ""}${Math.floor(totalProfit).toLocaleString()}`],
    homeNodes: [],
    awayNodes: [],
  });

  const phaseOrder: Record<string, number> = {
    plan: 0,
    precheck: 1,
    place: 2,
    retry: 3,
    settle: 4,
    queue: 5,
    makeup: 6,
    final: 99,
  };
  return stages.sort((a, b) =>
    a.key === "final"
      ? 1
      : b.key === "final"
        ? -1
        : a.at - b.at || (phaseOrder[a.key] ?? 50) - (phaseOrder[b.key] ?? 50),
  );
}
