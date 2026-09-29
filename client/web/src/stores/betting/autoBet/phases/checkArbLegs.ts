import type { BetOption } from "@changmen/client-core/models/betOption";
import type {
  ArbBetAttemptParams,
  ArbBetChecked,
  ArbBetReady,
} from "@/stores/betting/autoBet/phases/types";
import { isSingleLegPrecheckOnly } from "@/domain/betting/singleLegRate";
import { shouldSkipAccountRateOnStakeScale } from "@/extensions/arbBet/stakeScaleByProfit";
import { setArbExecutionTraceMeta } from "@/stores/betting/autoBet/arbProgressTrace";
import { a8Tip } from "@/shared/a8Notify";
import { buildArbProgressLegPair } from "@/shared/arbProgressLegMeta";
import { arbBetToastSeconds } from "@/shared/betTiming";
import { wait } from "@changmen/client-core/shared/wait";
import { getPolymarketPmSportBlockReasonFromOption } from "@changmen/venue-adapter/polymarket";
import { PLATFORMS } from "@changmen/venue-adapter/shared";
import { useAccountStore } from "@/stores/accountStore";
import { useLoseOrderStore } from "@/stores/loseOrderStore";
import { useUserStore } from "@/stores/userStore";
import {
  scheduleActiveBetRunRemoval,
  syncActiveBetFail,
  syncActiveBetPhase,
  syncActiveBetPrecheckResults,
} from "@/stores/betting/activeBetRunSync";

function stripPrecheckError(raw?: string): string {
  if (!raw)
    return "";
  return raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function resolveSkipAccountRate(
  side: "A" | "B",
  ready: ArbBetReady,
): boolean {
  if (isSingleLegPrecheckOnly(
    side,
    ready.accountA,
    ready.accountB,
    ready.checkAccountA,
    ready.checkAccountB,
  )) {
    return true;
  }
  return shouldSkipAccountRateOnStakeScale(
    ready.stakeScale,
    useUserStore().extensionPrefs.stakeScaleByProfit,
  );
}

/** 预检双腿；失败时 trace.finish 并返回 null */
export async function checkArbLegs(
  params: ArbBetAttemptParams,
  ready: ArbBetReady,
): Promise<ArbBetChecked | null> {
  const { bet, config, setMessage, trace } = params;
  const accountStore = useAccountStore();
  let {
    legA,
    legB,
    accountA,
    accountB,
    checkAccountA,
    checkAccountB,
    betBothLegs,
  } = ready;
  checkAccountA = checkAccountA ?? accountA;
  checkAccountB = checkAccountB ?? accountB;

  // [changmen 扩展] 原单核验异常时阻止该账号继续积累未知敞口；恢复后自动解除。
  const blocked = [...useLoseOrderStore().orders.values()].some(order =>
    order.pendingVenueOrderId && order.pendingVenueError
    && [checkAccountA, checkAccountB].some(account => account?.accountId === order.pendingVenueAccountId));
  if (blocked) {
    const reason = "PM 原单确认异常，暂停该账号新增套利";
    trace?.finish("fail", reason);
    setMessage(reason);
    syncActiveBetFail(bet.id, reason);
    return null;
  }

  syncActiveBetPhase(bet.id, "checking", "正在预检");

  if (checkAccountA)
    checkAccountA.active = true;
  if (checkAccountB)
    checkAccountB.active = true;

  for (const [account, leg, side] of [
    [checkAccountA, legA, "A"] as const,
    [checkAccountB, legB, "B"] as const,
  ]) {
    if (!account || leg.type !== PLATFORMS.Polymarket)
      continue;
    const pmBlock = getPolymarketPmSportBlockReasonFromOption(leg);
    if (pmBlock) {
      trace?.finish("fail", `${leg.type} ${leg.target}: ${pmBlock}`);
      syncActiveBetPrecheckResults(bet.id, {
        hasA: side === "A",
        okA: false,
        detailA: side === "A" ? pmBlock : undefined,
        hasB: side === "B",
        okB: false,
        detailB: side === "B" ? pmBlock : undefined,
      });
      scheduleActiveBetRunRemoval(bet.id);
      await wait(1000);
      return null;
    }
  }

  const checkStart = Date.now();
  const scanOddsA = Number(legA.odds) || 0;
  const scanOddsB = Number(legB.odds) || 0;
  legA.diagnosticLinkId = ready.linkId;
  legB.diagnosticLinkId = ready.linkId;
  legA.diagnosticAttempt = "initial";
  legB.diagnosticAttempt = "initial";

  const taskA = checkAccountA
    ? accountStore.checkBetting(checkAccountA, legA, {
        skipAccountRate: resolveSkipAccountRate("A", ready),
      })
    : undefined;
  const taskB = checkAccountB
    ? accountStore.checkBetting(checkAccountB, legB, {
        skipAccountRate: resolveSkipAccountRate("B", ready),
      })
    : undefined;

  const checked = await Promise.all([taskA, taskB].filter(Boolean) as Promise<BetOption>[]);
  let checkIdx = 0;
  if (checkAccountA)
    legA = checked[checkIdx++];
  if (checkAccountB)
    legB = checked[checkIdx++];

  const precheckLegs = buildArbProgressLegPair(
    legA,
    legB,
    checkAccountA,
    checkAccountB,
    {
      legA: checkAccountA
        ? { ok: Boolean(legA.data), error: legA.checkError }
        : undefined,
      legB: checkAccountB
        ? { ok: Boolean(legB.data), error: legB.checkError }
        : undefined,
    },
    trace?.getMeta()?.legs,
  );
  setArbExecutionTraceMeta(trace, { legs: precheckLegs });
  trace?.event("预检", "见下方对冲腿详情");

  function legPrecheckFailLabel(side: "A" | "B"): string | null {
    const leg = side === "A" ? legA : legB;
    const checkAccount = side === "A" ? checkAccountA : checkAccountB;
    if (!checkAccount || leg.data)
      return null;
    const base = `${leg.type} ${leg.target}: ${leg.checkError || "无盘口数据"}`;
    if (isSingleLegPrecheckOnly(side, accountA, accountB, checkAccountA, checkAccountB))
      return `${base}（9999仅预检）`;
    return base;
  }

  const dualPrecheckFailed = (checkAccountA && !legA.data) || (checkAccountB && !legB.data);

  if (dualPrecheckFailed) {
    const parts = [
      legPrecheckFailLabel("A"),
      legPrecheckFailLabel("B"),
    ].filter(Boolean);
    syncActiveBetPrecheckResults(bet.id, {
      hasA: Boolean(checkAccountA),
      okA: Boolean(checkAccountA && legA.data),
      detailA: checkAccountA && !legA.data
        ? (stripPrecheckError(legA.checkError) || "无盘口数据")
        : undefined,
      hasB: Boolean(checkAccountB),
      okB: Boolean(checkAccountB && legB.data),
      detailB: checkAccountB && !legB.data
        ? (stripPrecheckError(legB.checkError) || "无盘口数据")
        : undefined,
    });
    trace?.finish("fail", parts.join(" · ") || "预检未通过");
    scheduleActiveBetRunRemoval(bet.id);
    await wait(1000);
    return null;
  }

  syncActiveBetPrecheckResults(bet.id, {
    hasA: Boolean(checkAccountA),
    okA: true,
    hasB: Boolean(checkAccountB),
    okB: true,
  });

  // [A8 可证实] 预检通过后不再改 betMoney（PM 同：计划额 + 场馆跌价拒单）；orderIndex 在 checkTimeout 之前赋值
  if (accountA)
    legA.orderIndex = 1;
  if (accountB)
    legB.orderIndex = betBothLegs ? 2 : 1;
  if (config.checkTimeout && Date.now() - checkStart > config.checkTimeout) {
    const elapsed = Date.now() - checkStart;
    const msg = `超时时间：${elapsed}ms，大于设定值：${config.checkTimeout}ms`;
    setMessage(`前置检查超时 ${elapsed}ms`);
    a8Tip("前置检查超时", msg, 3000);
    trace?.finish("fail", msg);
    syncActiveBetFail(bet.id, msg);
    return null;
  }

  const waitSec = arbBetToastSeconds(
    config,
    [accountA?.provider, accountB?.provider].filter(Boolean) as string[],
  );

  return {
    ...ready,
    legA,
    legB,
    accountA,
    accountB,
    implied: ready.implied,
    waitSec,
    scanOddsA,
    scanOddsB,
  };
}
