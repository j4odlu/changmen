import type { BetOption } from "@changmen/client-core/models/betOption";
import type { ViewBet, ViewMatch } from "@/models/match";
import type { PlatformAccount } from "@/models/platformAccount";
import type { ActiveBetLegStatus, ActiveBetRunPhase } from "@/types/activeBetRun";
import type { MakeupRuntimePhase } from "@/types/order";
import { getActivePinia } from "pinia";
import { isPendingConfirmVenueProvider } from "@changmen/shared/account_multiply";
import { useActiveBetRunStore } from "@/stores/activeBetRunStore";
import { useLoseOrderStore } from "@/stores/loseOrderStore";

function activeStore() {
  if (!getActivePinia())
    return undefined;
  return useActiveBetRunStore();
}

function syncMakeupListPhase(betId: number, phase: MakeupRuntimePhase | undefined) {
  if (!getActivePinia())
    return;
  useLoseOrderStore().setMakeupRuntimePhase(betId, phase);
}

function legFromOption(
  side: "A" | "B",
  leg: BetOption,
  account?: PlatformAccount,
  status: ActiveBetLegStatus = "pending",
): {
  side: "A" | "B";
  platform: string;
  target: string;
  odds: number;
  betMoney: number;
  status: ActiveBetLegStatus;
  precheckOnly?: boolean;
  detail?: string;
  events: { at: number; stage: string; detail: string }[];
} {
  return {
    side,
    platform: leg.type,
    target: leg.target,
    odds: leg.odds,
    betMoney: leg.betMoney,
    status,
    detail: account?.playerName,
    events: [],
  };
}

/** 选腿成功：创建/刷新进行中记录 */
export function syncActiveBetBegin(params: {
  match: ViewMatch;
  bet: ViewBet;
  legA: BetOption;
  legB: BetOption;
  accountA?: PlatformAccount;
  accountB?: PlatformAccount;
  checkAccountA?: PlatformAccount;
  checkAccountB?: PlatformAccount;
  linkId: number;
  betBothLegs: boolean;
}) {
  const store = activeStore();
  if (!store)
    return;
  const {
    match,
    bet,
    legA,
    legB,
    accountA,
    accountB,
    checkAccountA: checkAIn,
    checkAccountB: checkBIn,
    linkId,
  } = params;
  const checkAccountA = checkAIn ?? accountA;
  const checkAccountB = checkBIn ?? accountB;

  function beginLeg(
    side: "A" | "B",
    leg: BetOption,
    betAccount?: PlatformAccount,
    checkAccount?: PlatformAccount,
  ): ReturnType<typeof legFromOption> {
    if (!checkAccount)
      return legFromOption(side, leg, undefined, "skipped");
    const row = legFromOption(side, leg, checkAccount, "pending");
    if (checkAccount && !betAccount) {
      row.precheckOnly = true;
      row.detail = [checkAccount.playerName, "9999仅预检"].filter(Boolean).join(" · ");
    }
    return row;
  }

  const legs = [
    beginLeg("A", legA, accountA, checkAccountA),
    beginLeg("B", legB, accountB, checkAccountB),
  ];

  store.upsertRun(bet.id, {
    matchId: match.id,
    matchTitle: match.title,
    betName: bet.getBetName(),
    linkId,
    mode: params.betBothLegs ? "arb" : "single9999",
    phase: "preparing",
    overallLabel: params.betBothLegs ? "准备双边套利" : "准备 9999 单边下单",
    legs,
  });
  if (checkAccountA)
    store.appendLegEvent(bet.id, "A", "预检", "正在预检");
  if (checkAccountB)
    store.appendLegEvent(bet.id, "B", "预检", "正在预检");
}

/** 预检结束：每腿追加「预检通过」或「预检失败」，并刷新整单标题/时间线 */
export function syncActiveBetPrecheckResults(
  betId: number,
  results: {
    hasA?: boolean;
    okA?: boolean;
    detailA?: string;
    hasB?: boolean;
    okB?: boolean;
    detailB?: string;
  },
) {
  const store = activeStore();
  if (!store)
    return;
  if (results.hasA) {
    if (results.okA) {
      store.appendLegEvent(betId, "A", "预检", "预检通过");
    }
    else {
      const detail = results.detailA?.trim()
        ? `预检失败 · ${results.detailA.trim()}`
        : "预检失败";
      store.patchLeg(betId, "A", { status: "failed", detail });
    }
  }
  if (results.hasB) {
    if (results.okB) {
      store.appendLegEvent(betId, "B", "预检", "预检通过");
    }
    else {
      const detail = results.detailB?.trim()
        ? `预检失败 · ${results.detailB.trim()}`
        : "预检失败";
      store.patchLeg(betId, "B", { status: "failed", detail });
    }
  }

  const checked: boolean[] = [];
  if (results.hasA)
    checked.push(Boolean(results.okA));
  if (results.hasB)
    checked.push(Boolean(results.okB));
  if (!checked.length)
    return;

  if (checked.some(ok => !ok)) {
    // 腿详情已在各腿时间线；整单只更新顶部标题，避免仍停在「正在预检」
    store.setPhase(betId, "syncing", "预检失败");
    return;
  }

  store.setPhase(betId, "checking", "预检通过");
}

export function syncActiveBetPhase(
  betId: number,
  phase: ActiveBetRunPhase,
  detail?: string,
  countdownSec?: number,
) {
  const store = activeStore();
  if (!store)
    return;
  // 整单状态只更新顶部 overallLabel；细节走各腿时间线
  store.setPhase(betId, phase, detail, countdownSec);
}

export function syncActiveBetLeg(
  betId: number,
  side: "A" | "B",
  status: ActiveBetLegStatus,
  detail?: string,
) {
  const store = activeStore();
  if (!store)
    return;
  store.patchLeg(betId, side, { status, detail });
}

/** 单腿 settle 结束后立即刷新 UI（不必等另一腿） */
export function syncActiveBetLegSettleResult(
  betId: number,
  side: "A" | "B",
  apiSuccess: boolean,
  venueRejected: boolean,
  opts?: {
    pendingConfirm?: boolean;
    provider?: string;
    pendingDetail?: string;
  },
) {
  if (!apiSuccess) {
    syncActiveBetLeg(betId, side, "failed");
    return;
  }
  if (venueRejected) {
    syncActiveBetLeg(betId, side, "rejected", "拒单");
    return;
  }
  if (opts?.pendingConfirm) {
    syncActiveBetLeg(
      betId,
      side,
      "pending_confirm",
      opts.pendingDetail?.trim() || "delayed 待确认",
    );
    return;
  }
  // A8：拒单等待通过 →「未拒单」，整单收尾再标「已成交」。
  // PM/PF：无 A8 拒单窗；filled 即成交。
  if (isPendingConfirmVenueProvider(opts?.provider))
    syncActiveBetLeg(betId, side, "confirmed", "已成交");
  else
    syncActiveBetLeg(betId, side, "confirmed", "未拒单");
}

/** [changmen 扩展] SaveOrderBind 重试仍失败时上屏 */
export function syncActiveBetBindFailed(
  betId: number,
  sides: Array<"A" | "B">,
  detail = "绑单失败",
) {
  const store = activeStore();
  if (!store || !sides.length)
    return;
  for (const side of sides)
    store.appendLegEvent(betId, side, "拒单", detail);
  store.setPhase(betId, "syncing", detail);
}

/** [changmen 扩展] 绑单成功：腿时间线追加「已绑单」（不覆盖拒单层结果） */
export function syncActiveBetBindSuccess(
  betId: number,
  sides: Array<"A" | "B">,
  detail = "已绑单",
) {
  const store = activeStore();
  if (!store || !sides.length)
    return;
  for (const side of sides)
    store.appendLegEvent(betId, side, "拒单", detail);
}

type PostLegResult = { success?: boolean; pending?: boolean; message?: string | null };
type PlaceOutcome =
  | "filled_pending_settle"
  | "accepted_pending_confirm"
  | "submit_unknown"
  | "api_failed"
  | "not_attempted";

function legStatusAfterPost(
  result?: PostLegResult,
  placeOutcome?: PlaceOutcome,
): ActiveBetLegStatus {
  if (placeOutcome === "not_attempted")
    return "failed";
  if (placeOutcome === "submit_unknown") return "pending_confirm";
  if (!result?.success)
    return "failed";
  if (result.pending || placeOutcome === "accepted_pending_confirm")
    return "pending_confirm";
  return "submitted";
}

function formatNotAttemptedDetail(skipReason?: string): string {
  const reason = String(skipReason ?? "").trim();
  return reason ? `未下单 · ${reason}` : "未下单";
}

function legDetailAfterPost(
  result?: PostLegResult,
  placeOutcome?: PlaceOutcome,
  skipReason?: string,
): string {
  if (placeOutcome === "not_attempted")
    return formatNotAttemptedDetail(skipReason);
  if (placeOutcome === "submit_unknown") return "提交结果不确定，核对原单中";
  const msg = String(result?.message ?? "").trim();
  if (!result?.success)
    return msg || "下单失败";
  if (placeOutcome === "accepted_pending_confirm")
    return "已挂单待确认";
  if (result.pending)
    return "delayed 待确认";
  return msg || "已提交";
}

export function syncActiveBetPlaceResults(
  betId: number,
  resultA?: PostLegResult,
  resultB?: PostLegResult,
  hasA?: boolean,
  hasB?: boolean,
  placeOutcomeA?: PlaceOutcome,
  placeOutcomeB?: PlaceOutcome,
  /** 混合对第二道闸等：两侧 not_attempted 时写进「未下单」详情 */
  skipReason?: string,
) {
  const store = activeStore();
  if (hasA) {
    syncActiveBetLeg(
      betId,
      "A",
      legStatusAfterPost(resultA, placeOutcomeA),
      legDetailAfterPost(resultA, placeOutcomeA, skipReason),
    );
    // 非 delayed/pending：进入拒单检测层（追加，不覆盖）；仅 API 成功腿
    if (store && resultA?.success && !resultA.pending)
      store.appendLegEvent(betId, "A", "拒单", "等待场馆确认");
  }
  if (hasB) {
    syncActiveBetLeg(
      betId,
      "B",
      legStatusAfterPost(resultB, placeOutcomeB),
      legDetailAfterPost(resultB, placeOutcomeB, skipReason),
    );
    if (store && resultB?.success && !resultB.pending)
      store.appendLegEvent(betId, "B", "拒单", "等待场馆确认");
  }
  const anyApiOk = Boolean(
    (hasA && resultA?.success) || (hasB && resultB?.success),
  );
  if (!anyApiOk) {
    const bothSkipped = placeOutcomeA === "not_attempted" && placeOutcomeB === "not_attempted";
    const reason = String(skipReason ?? "").trim();
    syncActiveBetPhase(
      betId,
      "syncing",
      bothSkipped && reason ? reason : "下单未成功",
    );
    return;
  }
  const venuePending = Boolean((hasA && resultA?.pending) || (hasB && resultB?.pending));
  syncActiveBetPhase(betId, "settling", venuePending ? "待场馆确认" : "等待场馆确认");
}

/** 补单受理后仍待确认：腿行与阶段立即反映 */
export function syncActiveBetMakeupPendingConfirm(betId: number, orderId?: string | null, error?: string) {
  const store = activeStore();
  if (!store)
    return;
  const run = store.runs.get(betId);
  const makeupLeg = run?.legs.find(l => l.status === "makeup" || l.status === "pending_confirm");
  const idHint = String(orderId ?? "").trim();
  const detail = error ? `待确认 · 核验诊断：${error}` : idHint
    ? `待确认 · ${idHint.slice(0, 10)}…`
    : "待确认";
  if (makeupLeg)
    store.patchLeg(betId, makeupLeg.side, { status: "makeup", detail });
  store.setPhase(betId, "makeup", "待场馆确认");
  if (makeupLeg)
    store.appendLegEvent(betId, makeupLeg.side, "补单", detail);
}

function finalizeLegDetail(flags: {
  ok: boolean;
  reject: boolean;
  placeOutcome?: PlaceOutcome;
  /** place 阶段已写入的详情（含「未下单 · 原因」时保留） */
  existingDetail?: string;
}): string | undefined {
  if (flags.ok)
    return "已成交";
  if (flags.reject)
    return "拒单";
  if (flags.placeOutcome === "not_attempted") {
    const existing = String(flags.existingDetail ?? "").trim();
    if (existing.startsWith("未下单"))
      return undefined;
    return "未下单";
  }
  if (flags.placeOutcome === "api_failed")
    return "下单失败";
  return undefined;
}

export function syncActiveBetAfterRejectSync(
  betId: number,
  flags: {
    hasA: boolean;
    hasB: boolean;
    rejectA: boolean;
    rejectB: boolean;
    pendingConfirmA?: boolean;
    pendingConfirmB?: boolean;
    okA: boolean;
    okB: boolean;
    makeupQueued: boolean;
    makeupEnabled?: boolean;
    makeupTarget?: "A" | "B";
    makeupPlatform?: string;
    placeOutcomeA?: PlaceOutcome;
    placeOutcomeB?: PlaceOutcome;
  },
) {
  const store = activeStore();
  if (!store)
    return;

  const run = store.runs.get(betId);
  const pendingA = Boolean(flags.pendingConfirmA);
  const pendingB = Boolean(flags.pendingConfirmB);

  if (flags.hasA) {
    const existingA = run?.legs.find(l => l.side === "A")?.detail;
    const detailA = pendingA
      ? (flags.placeOutcomeA === "accepted_pending_confirm" ? "已挂单待确认" : "delayed 待确认")
      : finalizeLegDetail({
        ok: flags.okA,
        reject: flags.rejectA,
        placeOutcome: flags.placeOutcomeA,
        existingDetail: existingA,
      });
    store.patchLeg(betId, "A", {
      status: flags.okA
        ? "confirmed"
        : pendingA
          ? "pending_confirm"
          : flags.rejectA
            ? "rejected"
            : "failed",
      ...(detailA !== undefined ? { detail: detailA } : {}),
    });
  }
  if (flags.hasB) {
    const existingB = run?.legs.find(l => l.side === "B")?.detail;
    const detailB = pendingB
      ? (flags.placeOutcomeB === "accepted_pending_confirm" ? "已挂单待确认" : "delayed 待确认")
      : finalizeLegDetail({
        ok: flags.okB,
        reject: flags.rejectB,
        placeOutcome: flags.placeOutcomeB,
        existingDetail: existingB,
      });
    store.patchLeg(betId, "B", {
      status: flags.okB
        ? "confirmed"
        : pendingB
          ? "pending_confirm"
          : flags.rejectB
            ? "rejected"
            : "failed",
      ...(detailB !== undefined ? { detail: detailB } : {}),
    });
  }

  if (flags.okA && flags.okB) {
    if (flags.hasA)
      store.appendLegEvent(betId, "A", "拒单", "已成交");
    if (flags.hasB)
      store.appendLegEvent(betId, "B", "拒单", "已成交");
    store.scheduleDismiss(betId);
    return;
  }

  // 一腿成、一腿拒：成功腿标已成交，拒单腿进补单（或保持补单中）
  if (flags.okA && flags.hasA)
    store.appendLegEvent(betId, "A", "拒单", "已成交");
  if (flags.okB && flags.hasB)
    store.appendLegEvent(betId, "B", "拒单", "已成交");
  if (flags.rejectA && flags.hasA)
    store.appendLegEvent(betId, "A", "拒单", "拒单");
  if (flags.rejectB && flags.hasB)
    store.appendLegEvent(betId, "B", "拒单", "拒单");
  if (pendingA && flags.hasA)
    store.appendLegEvent(betId, "A", "拒单", "delayed 待确认");
  if (pendingB && flags.hasB)
    store.appendLegEvent(betId, "B", "拒单", "delayed 待确认");

  // 待确认续查：挂补单队列但腿态保持 pending_confirm（jb 续查原单，非立刻重下）
  if (flags.makeupQueued && (pendingA || pendingB)) {
    store.setPhase(
      betId,
      flags.makeupEnabled === false ? "settling" : "makeup",
      flags.makeupEnabled === false ? "待场馆确认 · 自动补单关闭" : "待场馆确认",
    );
    // 关闭补单时只展示 delayed 原单确认，不把另一腿标成“补单中”。
    if (flags.makeupEnabled === false)
      return;
    if (flags.makeupTarget && flags.makeupPlatform) {
      const pendingSide = pendingA ? "A" : "B";
      const pendingIsAnchor = flags.makeupTarget !== pendingSide;
      store.patchLeg(betId, flags.makeupTarget, {
        status: pendingIsAnchor ? "makeup" : "pending_confirm",
        platform: flags.makeupPlatform,
        detail: pendingIsAnchor ? "等待锚腿确认后补单" : "待确认 · 下轮续查",
      });
      store.appendLegEvent(
        betId,
        flags.makeupTarget,
        "补单",
        pendingIsAnchor ? "等待锚腿确认（未确认不补新单）" : "续查原单（未确认不补新单）",
      );
    }
    return;
  }

  // 队列可以按 A8 语义先创建，但关闭补单时不会被主循环消费。
  if (flags.makeupQueued && flags.makeupEnabled === false) {
    store.setPhase(betId, "syncing", "自动补单已关闭");
    if (flags.makeupTarget) {
      store.patchLeg(betId, flags.makeupTarget, {
        status: (flags.makeupTarget === "A" && flags.rejectA)
          || (flags.makeupTarget === "B" && flags.rejectB)
          ? "rejected"
          : "failed",
        detail: "自动补单已关闭，未执行补单",
      });
      store.appendLegEvent(
        betId,
        flags.makeupTarget,
        "补单",
        "自动补单已关闭，未执行",
      );
    }
    store.scheduleTerminalRemoval(betId);
    return;
  }

  if (flags.makeupQueued || ((flags.okA || flags.okB) && (flags.rejectA || flags.rejectB))) {
    store.setPhase(betId, "makeup", "补单中");
    if (flags.makeupQueued && flags.makeupTarget && flags.makeupPlatform) {
      store.patchLeg(betId, flags.makeupTarget, {
        status: "makeup",
        platform: flags.makeupPlatform,
        detail: "已入补单队列",
      });
      store.appendLegEvent(
        betId,
        flags.makeupTarget,
        "补单",
        flags.makeupPlatform ? `补 ${flags.makeupPlatform}` : "已入队",
      );
    }
    return;
  }

  if (pendingA || pendingB) {
    store.setPhase(betId, "settling", "待场馆确认");
    return;
  }

  // [changmen 扩展] 9999 仅以下单腿收尾，不等待仅预检/不参与的另一腿成交。
  if (run?.mode === "single9999" && ((flags.hasA && flags.okA) || (flags.hasB && flags.okB))) {
    store.scheduleTerminalRemoval(betId, undefined, "单边下单已完成");
    return;
  }

  if (!flags.okA && !flags.okB) {
    if (flags.hasA)
      store.appendLegEvent(betId, "A", "拒单", "未成单");
    if (flags.hasB)
      store.appendLegEvent(betId, "B", "拒单", "未成单");
    // 双侧 not_attempted：保留 place 阶段写入的第二道闸原因，勿盖成光秃「未成单」
    const bothNotAttempted
      = flags.placeOutcomeA === "not_attempted" && flags.placeOutcomeB === "not_attempted";
    const skipDetail = bothNotAttempted
      ? (run?.legs ?? [])
          .map(l => String(l.detail ?? "").trim())
          .find(d => d.startsWith("未下单 · "))
      : undefined;
    const skipReason = skipDetail?.slice("未下单 · ".length).trim();
    store.setPhase(betId, "syncing", skipReason || "未成单");
    store.scheduleTerminalRemoval(betId);
    return;
  }

  store.setPhase(betId, "settling", "部分成功，等待后续");
}

export function syncActiveBetFail(betId: number, reason: string) {
  const store = activeStore();
  if (!store)
    return;
  const run = store.runs.get(betId);
  const failLayer = run?.phase === "checking" || run?.phase === "preparing"
    ? "预检"
    : run?.phase === "settling" || run?.phase === "syncing"
      ? "拒单"
      : "下单";
  const parts = reason.split(" · ").map(s => s.trim()).filter(Boolean);
  if (run && parts.length > 1) {
    for (const part of parts) {
      const leg = run.legs.find((row) => {
        const prefix = `${row.platform} ${row.target}:`;
        return part.startsWith(prefix) || part.startsWith(`${row.platform} `);
      });
      if (!leg)
        continue;
      const detail = part.includes(":") ? part.slice(part.indexOf(":") + 1).trim() : part;
      if (leg.status !== "failed")
        store.patchLeg(betId, leg.side, { status: "failed", detail: detail || part });
      else
        store.appendLegEvent(betId, leg.side, failLayer, detail || part);
    }
  }
  else {
    for (const leg of run?.legs ?? []) {
      if (leg.status !== "skipped" && leg.status !== "failed")
        store.appendLegEvent(betId, leg.side, failLayer, reason);
    }
  }
  store.setPhase(betId, "syncing", reason || "失败");
  store.scheduleTerminalRemoval(betId);
}

/** 失败或拦截结果短暂停留后，从实时面板移除。 */
export function scheduleActiveBetRunRemoval(betId: number, delayMs = 6000) {
  activeStore()?.scheduleTerminalRemoval(betId, delayMs);
}

export function syncActiveBetMakeupEnqueue(
  betId: number,
  targetSide: "A" | "B",
  platform: string,
  target: string,
) {
  const store = activeStore();
  if (!store)
    return;
  const run = store.runs.get(betId);
  if (!run) {
    store.upsertRun(betId, {
      matchId: 0,
      matchTitle: "",
      betName: "",
      phase: "makeup",
      overallLabel: "补单中",
      legs: [
        {
          side: targetSide,
          platform,
          target,
          status: "makeup",
          events: [],
        },
        {
          side: targetSide === "A" ? "B" : "A",
          platform: "—",
          target: target === "Home" ? "Away" : "Home",
          status: "skipped",
          events: [],
        },
      ],
    });
  }
  else {
    store.setPhase(betId, "makeup", "补单中");
    store.patchLeg(betId, targetSide, { status: "makeup", platform, detail: "已入补单队列" });
  }
  store.appendLegEvent(betId, targetSide, "补单", `${platform} 入队`);
}

export function syncActiveBetMakeupAttempt(
  betId: number,
  platform: string,
  detail: string,
  targetSide?: "A" | "B",
) {
  syncMakeupListPhase(betId, "placing");
  const store = activeStore();
  if (!store)
    return;
  if (!store.runs.has(betId))
    return;
  const side = targetSide ?? store.runs.get(betId)?.legs.find(l => l.status === "makeup")?.side;
  store.setPhase(betId, "makeup", `补单中 · ${platform}`);
  if (side)
    store.appendLegEvent(betId, side, "补单", detail);
}

export function syncActiveBetMakeupSettling(betId: number, waitSec: number) {
  syncMakeupListPhase(betId, "settling");
  const store = activeStore();
  const makeupLeg = store?.runs.get(betId)?.legs.find(l => l.status === "makeup" || l.status === "pending_confirm");
  syncActiveBetPhase(betId, "settling", "补单已提交，等待场馆确认", waitSec);
  if (store && makeupLeg)
    store.appendLegEvent(betId, makeupLeg.side, "补单", "等待场馆确认");
}

export function syncActiveBetMakeupRejected(betId: number, target: string) {
  syncMakeupListPhase(betId, "rejected_retry");
  const store = activeStore();
  if (!store)
    return;
  const run = store.runs.get(betId);
  const makeupLeg = run?.legs.find(l => l.status === "makeup" || l.target === target);
  store.setPhase(betId, "makeup", `${target} 再次被拒单`);
  if (makeupLeg)
    store.appendLegEvent(betId, makeupLeg.side, "补单", `${target} 再次被拒单`);
}

export function syncActiveBetMakeupDone(betId: number, platform: string, odds: number) {
  syncMakeupListPhase(betId, undefined);
  const store = activeStore();
  if (!store)
    return;
  const run = store.runs.get(betId);
  const makeupLeg = run?.legs.find(l => l.status === "makeup" || l.platform === platform);
  const detail = `补单成功 @${odds}`;
  if (makeupLeg)
    store.appendLegEvent(betId, makeupLeg.side, "补单", detail);
  store.scheduleDismiss(betId);
}
