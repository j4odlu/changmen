import type { BetSide, ViewBet, ViewBetItem, ViewMatch } from "@/models/match";
import type { UserConfig } from "@/types/userConfig";
import { BetOption } from "@changmen/client-core/models/betOption";
import { ElMessageBox } from "element-plus";
import { h, ref } from "vue";
import PmManualOrderPrompt from "@/components/betting/PmManualOrderPrompt.vue";
import { capturePmPriceQuote } from "@/domain/polymarket/tickBufferQuote";
import { isMapMuteActive } from "@/extensions/mapBetMute";
import { isPrematchFullMarketAllowed } from "@/extensions/prematchFullOnly";
import { readValueBetMoney } from "@/extensions/valueBet/valueBetStake";
import { useAccountStore } from "@/stores/accountStore";
import { executeManualOrder } from "@/stores/betting/execution/manual";
import { captureManualExecutionSelection } from "@/stores/betting/execution/selection";
import {
  buildManualBetContextLines,
} from "@/stores/betting/manualBetAlert";
import { useUserStore } from "@/stores/userStore";

/** 手动下单默认金额：优先正EV金额，未配置时回退套利 betMoney */
export function defaultManualBetAmount(
  config: Pick<UserConfig, "valueBetMoney" | "betMoney"> | null | undefined,
): number {
  const ev = readValueBetMoney(config);
  if (ev > 0)
    return ev;
  const arb = Number(config?.betMoney);
  return Number.isFinite(arb) && arb > 0 ? arb : 10;
}

export interface ManualBetContext {
  setMessage: (msg: string) => void;
}

/** 手动下单 prompt 正文：展示赛事、盘口、平台与所选边 */
export function buildManualBetPromptMessage(
  match: ViewMatch,
  bet: ViewBet,
  item: ViewBetItem,
  side: BetSide,
  odds: number,
): string {
  return [
    ...buildManualBetContextLines(match, bet, item, side, odds),
    "",
    "请输入要买入的金额",
  ].join("\n");
}

/** [A8 可证实] 双击赔率手动下单；[changmen 扩展] oddsOverride 用于影子价点击时用旁显价作接受下限 */
export async function runManualBet(
  match: ViewMatch,
  bet: ViewBet,
  item: ViewBetItem,
  side: BetSide,
  ctx: ManualBetContext,
  oddsOverride?: number,
): Promise<void> {
  const accountStore = useAccountStore();
  const user = useUserStore();
  const { setMessage } = ctx;

  // 先 getAccount(type, 0)，无账号再提示；有账号才 prompt 金额
  const account = accountStore.getAccount(item.type, 0);
  if (!account) {
    await ElMessageBox.alert("没有找到对应的账号", String(item.type));
    return;
  }

  const fromItem = item.getOdds(side);
  const odds
    = oddsOverride != null && Number.isFinite(oddsOverride) && oddsOverride > 0
      ? oddsOverride
      : fromItem;
  let frozenPmOption: BetOption | undefined;
  if (item.type === "Polymarket") {
    frozenPmOption = new BetOption(match, bet, item, side, 0);
    frozenPmOption.odds = odds;
    try { capturePmPriceQuote(frozenPmOption); }
    catch (err) {
      await ElMessageBox.alert(err instanceof Error ? err.message : String(err), "PM 报价不可用");
      return;
    }
  }
  let amount: number;
  // [changmen 扩展] 仅本次 PM 手动单选择模式，不继承/修改自动套利偏好。
  const pmOrderMode = ref<"FOK" | "GTC">("FOK");
  try {
    const promptMessage = buildManualBetPromptMessage(match, bet, item, side, odds);
    const { value } = await ElMessageBox.prompt(
      item.type === "Polymarket"
        ? h(PmManualOrderPrompt, { "context": promptMessage, "onUpdate:modelValue": (mode: "FOK" | "GTC") => { pmOrderMode.value = mode; } })
        : promptMessage,
      "手动下单",
      {
        confirmButtonText: "确定",
        cancelButtonText: "取消",
        inputValue: String(defaultManualBetAmount(user.config)),
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

  const option = frozenPmOption ?? new BetOption(match, bet, item, side, amount);
  if (frozenPmOption)
    option.betMoney = Math.round(amount * 100) / 100;
  option.odds = odds;
  // [changmen 扩展] 比例 9999 仅控制自动下单；手动下单使用用户输入金额。
  const selection = captureManualExecutionSelection(pmOrderMode.value);
  // [A8 可证实] index0706.js 手动入口 p：选账号、输入金额后直接平台预检，不套用自动筛选或余额门控。
  if (item.type === "Polymarket" && selection.orderMode === "GTC") {
    // [changmen 扩展] 模式在金额弹窗中确定；PM GTC 保留原有盘口开关和本金余额检查。
    if (isMapMuteActive(match.id, bet.round, match.liveRound)
      || !isPrematchFullMarketAllowed(match, bet)) {
      return;
    }
    const bal = account.getBalance();
    if (bal !== undefined && bal < amount) {
      await ElMessageBox.alert(`余额不足（${bal} < ${amount}）`, String(item.type));
      return;
    }
  }
  await executeManualOrder(account, option, selection, {
    match,
    bet,
    item,
    side,
    odds,
    amount,
    setMessage,
    accountStore,
  });
}
