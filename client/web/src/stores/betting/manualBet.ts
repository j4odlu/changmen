import type { BetSide, ViewBet, ViewBetItem, ViewMatch } from "@/models/match";
import { ElMessageBox } from "element-plus";
import { accountPassesMainBetFilter } from "@/domain/betting/betFilters";
import { BetOption } from "@changmen/client-core/models/betOption";
import { wait } from "@changmen/client-core/shared/wait";
import { isPrematchFullMarketAllowed } from "@/extensions/prematchFullOnly";
import { isMapMuteActive } from "@/extensions/mapBetMute";
import type { UserConfig } from "@/types/userConfig";
import { readValueBetMoney } from "@/extensions/valueBet/valueBetStake";
import { manualBetToastSeconds } from "@/shared/betTiming";
import { useAccountStore } from "@/stores/accountStore";
import {
  buildManualBetCheckFailureHtml,
  buildManualBetContextLines,
} from "@/stores/betting/manualBetAlert";
import { refreshOrderListAfterBind } from "@/stores/betting/arbOrderBind";
import { markSuccessfulBet } from "@/stores/betting/successMarkers";
import { useUserStore } from "@/stores/userStore";
import { useMatchStore } from "@/stores/matchStore";
import { isPendingConfirmVenueProvider } from "@changmen/shared/account_multiply";
import { capturePmPriceQuote } from "@/domain/polymarket/tickBufferQuote";

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
  const matchStore = useMatchStore();
  const { setMessage } = ctx;

  // [changmen 扩展] 折叠/总关盘口与赛前全场过滤均不得绕过核心手动下注入口
  if (isMapMuteActive(match.id, bet.round, match.liveRound)
    || !isPrematchFullMarketAllowed(match, bet))
    return;

  // 先 getAccount(type, 0)，无账号再提示；有账号才 prompt 金额
  const account = accountStore.getAccount(item.type, 0);
  if (!account) {
    await ElMessageBox.alert("没有找到对应的账号", String(item.type));
    return;
  }

  const fromItem = item.getOdds(side);
  const odds =
    oddsOverride != null && Number.isFinite(oddsOverride) && oddsOverride > 0
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
  try {
    const { value } = await ElMessageBox.prompt(
      buildManualBetPromptMessage(match, bet, item, side, odds),
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

  let option = frozenPmOption ?? new BetOption(match, bet, item, side, amount);
  if (frozenPmOption) option.betMoney = Math.round(amount * 100) / 100;
  option.odds = odds;
  // [changmen 扩展] 比例 9999 仅控制自动下单；手动下单使用用户输入金额。
  if (!accountPassesMainBetFilter(account, bet, match, option, matchStore)) {
    await ElMessageBox.alert(`当前 ${item.type} 账号不满足买入条件`, "提示");
    return;
  }
  const bal = account.getBalance();
  if (bal !== undefined && bal < amount) {
    await ElMessageBox.alert(`余额不足（${bal} < ${amount}）`, String(item.type));
    return;
  }
  const toastSec = manualBetToastSeconds();
  // [changmen 扩展] 手动金额仅换算币种，不应用自动下注的账号比例（含 9999）。
  option = await accountStore.checkBetting(account, option, { skipAccountRate: true });
  if (!option.data) {
    await ElMessageBox.alert(
      buildManualBetCheckFailureHtml(match, bet, item, side, odds, amount, option.checkError),
      `${item.type} 预检未通过`,
      {
        dangerouslyUseHTMLString: true,
        customClass: "manual-bet-result-box",
        confirmButtonText: "知道了",
      },
    );
    return;
  }
  const result = await accountStore.betting(account, option, toastSec);
  if (result?.success) {
    // PM/PF pending：受理≠成交，等 settle 确认后再 mark
    const skipMark = isPendingConfirmVenueProvider(account.provider) && result.pending;
    if (!skipMark)
      markSuccessfulBet(account, bet.id, side, option.odds);
    setMessage(
      result.pending
        ? `手动下单确认中 ${item.type}@${option.odds}`
        : `手动下单成功 ${item.type}@${option.odds}`,
    );
    // [changmen 扩展] PM matched 已在 placeBet 用 POST 乐观落库；此处刷侧栏 + 后台校正
    try {
      const provider = String(account.provider ?? "");
      const optimisticOk = Boolean(
        (result.tip as { pmOptimisticSaved?: boolean } | null | undefined)?.pmOptimisticSaved,
      );
      if (result.pending || provider !== "Polymarket") {
        await wait(result.orderId ? 400 : 1500);
        await accountStore.updateVenueOrders(account);
      }
      else if (!optimisticOk) {
        // matched 但乐观落库失败：短重试等 trades，避免侧栏空窗
        await wait(400);
        await accountStore.updateVenueOrders(account, {
          waitForOrderId: String(result.orderId ?? "").trim() || undefined,
        });
      }
      else {
        void accountStore.updateVenueOrders(account);
      }
      refreshOrderListAfterBind();
    }
    catch {
      // updateVenueOrders 已吞错；此处仅兜底 wait/刷新异常，不影响成功提示
    }
    // delayed：由 notifyPendingVenueConfirm 在 settle 确认后刷，避免早刷盖回旧余额
    if (!result.pending)
      void accountStore.refreshBalance(account);
  }
  else {
    const message = result?.message || "下单失败";
    await ElMessageBox.alert(
      buildManualBetCheckFailureHtml(match, bet, item, side, odds, amount, message, "order"), "下单失败", {
        dangerouslyUseHTMLString: true,
        customClass: "manual-bet-result-box",
        confirmButtonText: "知道了",
      });
  }
}
