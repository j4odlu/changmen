import type { BetSide, ViewBet, ViewBetItem, ViewMatch } from "@/models/match";
import { ElMessageBox } from "element-plus";
import {
  computeValueBetEdge,
  isValueBetPositiveEdge,
} from "@/extensions/valueBet/computeValueBetEdge";
import { coerceValueBetAutoBetRuntime, valueBetCalcOptsFromPrefs } from "@/extensions/valueBet/evConfig";
import { readValueBetMoney } from "@/extensions/valueBet/valueBetStake";
import { toFixed } from "@changmen/client-core/shared/format";
import { useAccountStore } from "@/stores/accountStore";
import {
  buildManualBetCheckFailureHtml,
  buildManualBetContextLines,
} from "@/stores/betting/manualBetAlert";
import { placeValueBetOrder } from "@/stores/betting/placeValueBet";
import { useUserStore } from "@/stores/userStore";

export interface ValueBetConfirmContext {
  setMessage: (msg: string) => void;
}

export function buildValueBetConfirmPromptMessage(
  match: ViewMatch,
  bet: ViewBet,
  item: ViewBetItem,
  side: BetSide,
  snap: { softOdds: number; fairOdds: number; edge: number },
  sharp = "PB",
): string {
  const team = side === "Home" ? bet.homeName : bet.awayName;
  return [
    ...buildManualBetContextLines(match, bet, item, side, snap.softOdds),
    `公允(${sharp})：${toFixed(snap.fairOdds, 3)}`,
    `Edge：+${(snap.edge * 100).toFixed(1)}% · ${team}`,
    "",
    "确认后按下方金额单边下单（非套利）。可修改金额。",
  ].join("\n");
}

/**
 * [changmen 扩展] 正 EV 半自动确认下单（P1）。
 * 入口：点击金色 edge 角标；不改双击手动下单；不进套利 linkId/makeup。
 * 正 EV 不与套利/补单互斥（可并行）。
 */
export async function runValueBetConfirm(
  match: ViewMatch,
  bet: ViewBet,
  item: ViewBetItem,
  side: BetSide,
  ctx: ValueBetConfirmContext,
): Promise<void> {
  const user = useUserStore();
  if (user.config.valueBetConfirm === false) {
    await ElMessageBox.alert("已关闭「正EV确认下单」，请在参数配置中开启", "正 EV");
    return;
  }

  const calcOpts = valueBetCalcOptsFromPrefs({
    ...user.extensionPrefs?.valueBet,
    softPlatforms: user.extensionPrefs?.valueBetSoftPlatforms,
  });
  const snap = computeValueBetEdge(bet, item, side, calcOpts);
  if (!snap || !isValueBetPositiveEdge(snap.edge, calcOpts.minEdge)) {
    const minPct = (calcOpts.minEdge * 100).toFixed(1).replace(/\.0$/, "");
    await ElMessageBox.alert(`正 EV 已消失或不足 ${minPct}%，请刷新后再试`, "正 EV");
    return;
  }

  const accountStore = useAccountStore();
  const { setMessage } = ctx;

  const account = accountStore.getAccount(item.type, 0);
  if (!account) {
    await ElMessageBox.alert("没有找到对应的账号", String(item.type));
    return;
  }

  const defaultAmount = readValueBetMoney(user.config);
  if (defaultAmount <= 0) {
    await ElMessageBox.alert("请先在参数配置中设置「正EV金额」", "正 EV");
    return;
  }

  let amount: number;
  try {
    const { value } = await ElMessageBox.prompt(
      buildValueBetConfirmPromptMessage(match, bet, item, side, snap, calcOpts.sharp),
      "正 EV 下单",
      {
        confirmButtonText: "确定",
        cancelButtonText: "取消",
        inputValue: String(defaultAmount),
        inputType: "number",
        inputValidator: val => (Number(val) > 0 ? true : "请输入有效金额"),
        customClass: "manual-bet-prompt-box",
      },
    );
    amount = Number(value);
    if (!amount || amount <= 0)
      return;
  }
  catch {
    return;
  }

  const autoBet = user.extensionPrefs?.valueBet?.autoBet;
  const placed = await placeValueBetOrder({
    match,
    bet,
    item,
    side,
    amount,
    calcOpts,
    minEdge: calcOpts.minEdge,
    mapLimit: autoBet?.enabled === true
      ? coerceValueBetAutoBetRuntime(autoBet).maxPerMap
      : undefined,
  });

  if (!placed.ok) {
    if (placed.code === "busy") {
      await ElMessageBox.alert("正 EV 下单进行中，请稍后再试", "正 EV");
      return;
    }
    if (placed.code === "muted") {
      await ElMessageBox.alert("该地图已折叠，已取消下单", "正 EV");
      return;
    }
    if (placed.code === "map_limit") {
      await ElMessageBox.alert("该局已达「同图次数」，已取消下单", "正 EV");
      return;
    }
    if (placed.code === "gone") {
      await ElMessageBox.alert("确认期间正 EV 已消失，已取消下单", "正 EV");
      return;
    }
    if (placed.code === "no_account") {
      await ElMessageBox.alert("没有找到对应的账号", String(item.type));
      return;
    }
    if (placed.code === "rate_9999") {
      await ElMessageBox.alert(
        "该账号在此赔率区间为比例 9999 单边模式，请改比例或换账号后再试",
        "提示",
      );
      return;
    }
    if (placed.code === "filter") {
      await ElMessageBox.alert(`当前 ${item.type} 账号不满足买入条件`, "提示");
      return;
    }
    if (placed.code === "balance") {
      await ElMessageBox.alert(`余额不足（${placed.message} < ${amount}）`, String(item.type));
      return;
    }
    if (placed.code === "check_fail") {
      await ElMessageBox.alert(
        buildManualBetCheckFailureHtml(
          match,
          bet,
          item,
          side,
          placed.snap?.softOdds ?? snap.softOdds,
          placed.amount ?? amount,
          placed.message,
        ),
        `${item.type} 预检未通过`,
        {
          dangerouslyUseHTMLString: true,
          customClass: "manual-bet-result-box",
          confirmButtonText: "知道了",
        },
      );
      return;
    }
    const message = placed.message || "下单失败";
    await ElMessageBox.alert(
      buildManualBetCheckFailureHtml(match, bet, item, side, placed.snap?.softOdds ?? snap.softOdds, placed.amount ?? amount, message, "order"), "下单失败", {
        dangerouslyUseHTMLString: true,
        customClass: "manual-bet-result-box",
        confirmButtonText: "知道了",
      });
    return;
  }

  setMessage(
    placed.pending
      ? `正EV确认中 ${placed.type}@${placed.odds} +${(placed.edge * 100).toFixed(1)}%`
      : placed.bound
        ? `正EV下单成功 ${placed.type}@${placed.odds} +${(placed.edge * 100).toFixed(1)}%`
        : `正EV下单成功 ${placed.type}@${placed.odds}（💎 标记稍后刷新）`,
  );
}
