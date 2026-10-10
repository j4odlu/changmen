import type { BetOption } from "@changmen/client-core/models/betOption";
import type { BetSide, ViewBet, ViewBetItem, ViewMatch } from "@/models/match";
import type { PlatformAccount } from "@/models/platformAccount";
import type { useAccountStore } from "@/stores/accountStore";
import { wait } from "@changmen/client-core/shared/wait";
import { isPendingConfirmVenueProvider } from "@changmen/shared/account_multiply";
import { ElMessageBox } from "element-plus";
import { manualBetToastSeconds } from "@/shared/betTiming";
import { refreshOrderListAfterBind } from "@/stores/betting/arbOrderBind";
import { buildManualBetCheckFailureHtml } from "@/stores/betting/manualBetAlert";
import { markSuccessfulBet } from "@/stores/betting/successMarkers";

export interface ManualExecutionContext {
  match: ViewMatch;
  bet: ViewBet;
  item: ViewBetItem;
  side: BetSide;
  odds: number;
  amount: number;
  setMessage: (message: string) => void;
  accountStore: ReturnType<typeof useAccountStore>;
}

/** FOK execution body is frozen to the pre-GTC baseline. */
export async function executeManualFok(account: PlatformAccount, option: BetOption, context: ManualExecutionContext): Promise<void> {
  const { match, bet, item, side, odds, amount, setMessage, accountStore } = context;
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
      buildManualBetCheckFailureHtml(match, bet, item, side, odds, amount, message, "order"),
      "下单失败",
      {
        dangerouslyUseHTMLString: true,
        customClass: "manual-bet-result-box",
        confirmButtonText: "知道了",
      },
    );
  }
}
