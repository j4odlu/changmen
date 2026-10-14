import type { RayLateRejectMakeupStatus, RayOrderContext } from "./types";
import { saveUserLog } from "@/api/chat";
import { enqueueMakeUpOrder } from "@/stores/betting/autoBet/makeUp";
import { useLoseOrderStore } from "@/stores/loseOrderStore";
import { useMatchStore } from "@/stores/matchStore";
import { useUserStore } from "@/stores/userStore";
import { useRayOrderContextStore } from "./contextStore";

const inflight = new Set<string>();

function writeActionLog(
  task: RayOrderContext,
  status: RayLateRejectMakeupStatus,
  reason: string,
): void {
  void saveUserLog(`RAY延迟拒单自动补单 => ${status}`, {
    diagnosticVersion: 3,
    monitoringMode: "ray-late-reject-auto-makeup",
    monitorEvent: "auto_makeup",
    linkId: task.linkId,
    provider: "RAY",
    accountId: task.accountId,
    orderId: task.boundOrderId ?? null,
    betId: task.betId,
    side: task.side,
    target: task.target,
    actionStatus: status,
    actionReason: reason,
    anchorProvider: task.anchorProvider,
    anchorAccountId: task.anchorAccountId,
    anchorBetMoney: task.anchorBetMoney,
    anchorOdds: task.anchorOdds,
    rejectDelayMs: task.rejectDelayMs ?? null,
    changmenExtension: true,
  }).catch(() => {});
}

function finish(
  task: RayOrderContext,
  status: RayLateRejectMakeupStatus,
  reason: string,
): void {
  const now = Date.now();
  useRayOrderContextStore().patch(task.key, {
    autoMakeupStatus: status,
    autoMakeupReason: reason,
    autoMakeupAt: now,
    updatedAt: now,
  });
  writeActionLog(task, status, reason);
}

/**
 * [changmen 扩展] 将唯一确认的 RAY 延迟拒单交给现有补单队列。
 * 本模块不计算补单金额/赔率、不直接下注；所有规则继续由 enqueueMakeUpOrder + jb 消费链负责。
 */
export async function handleRayLateRejectAutoMakeup(task: RayOrderContext, current: () => boolean = () => true): Promise<void> {
  if (inflight.has(task.key))
    return;
  inflight.add(task.key);
  try {
    if (!current())
      return;
    const monitorStore = useRayOrderContextStore();
    const latest = monitorStore.tasks.get(task.key);
    if (!latest || latest.status !== "rejected")
      return;
    if (latest.autoMakeupStatus && latest.autoMakeupStatus !== "enqueuing")
      return;

    const user = useUserStore();
    if (user.extensionPrefs?.rayLateRejectAutoMakeup?.enabled !== true) {
      finish(latest, "disabled", "自动补单开关已关闭");
      return;
    }
    if (user.config.makeUp !== true) {
      finish(latest, "skipped", "参数配置中的自动补单未开启");
      return;
    }
    if (!latest.anchorConfirmed || !latest.anchorAccountId || latest.anchorBetMoney <= 0 || latest.anchorOdds <= 0) {
      finish(latest, "skipped", "另一腿未形成可确认的补单锚点");
      return;
    }

    const loseStore = useLoseOrderStore();
    loseStore.ensureOrdersMap();
    if (loseStore.cancelledOrders.has(latest.betId)) {
      finish(latest, "skipped", "该盘口补单已被用户手动取消");
      return;
    }
    const existing = loseStore.orders.get(latest.betId);
    if (existing) {
      if (Number(existing.linkId) === latest.linkId && existing.target === latest.target)
        finish(latest, "enqueued", "现有补单队列已包含该拒单腿");
      else
        finish(latest, "skipped", "盘口已有其他补单任务，未覆盖现有队列");
      return;
    }

    const matchStore = useMatchStore();
    const match = matchStore.matchs.find(row => row.id === latest.matchId);
    const bet = match?.bets.find(row => row.id === latest.betId);
    if (!match || !bet) {
      finish(latest, "skipped", "比赛或盘口已离开当前列表");
      return;
    }

    monitorStore.patch(latest.key, {
      autoMakeupStatus: "enqueuing",
      autoMakeupReason: "正在交给现有补单策略",
      autoMakeupAt: Date.now(),
      updatedAt: Date.now(),
    });
    const enqueued = await enqueueMakeUpOrder({
      loseStore,
      match,
      bet,
      config: user.config,
      setMessage: message => matchStore.setBettingMessage(message),
      linkId: latest.linkId,
      accountId: latest.anchorAccountId,
      target: latest.target,
      betMoney: latest.anchorBetMoney,
      betOdds: latest.anchorOdds,
      failedLegOdds: latest.odds,
      failedPlatformLabel: "RAY(延迟拒单)",
    });
    if (!current())
      return;
    finish(
      latest,
      enqueued ? "enqueued" : "skipped",
      enqueued ? "已进入现有补单队列" : "未通过现有补单策略的入队条件",
    );
  }
  catch (error) {
    if (current())
      finish(task, "failed", error instanceof Error ? error.message : String(error));
  }
  finally {
    inflight.delete(task.key);
  }
}
