import type { BetOption } from "@changmen/client-core/models/betOption";
import type { BetSide, ViewBet, ViewBetItem, ViewMatch } from "@/models/match";
import type { PlatformAccount } from "@/models/platformAccount";
import type { useAccountStore } from "@/stores/accountStore";
import { ElMessage, ElMessageBox } from "element-plus";
import { useUserStore } from "@/stores/userStore";
import { gtcAccountAllows } from "./accountFilter";
import { executeManualGtc } from "./manual";
import { refreshGtcOrders } from "./ordersApi";

export interface GtcManualContext {
  match: ViewMatch;
  bet: ViewBet;
  item: ViewBetItem;
  side: BetSide;
  odds: number;
  amount: number;
  setMessage: (message: string) => void;
  accountStore: ReturnType<typeof useAccountStore>;
}

export async function runManualGtc(account: PlatformAccount, option: BetOption, context: GtcManualContext): Promise<void> {
  try {
    if (!gtcAccountAllows(account, option, context.bet, context.match, String(useUserStore().userId), false, true)) {
      await ElMessageBox.alert("当前 Polymarket 账号不满足买入条件", "提示");
      return;
    }
    const result = await executeManualGtc(account, option, context);
    context.setMessage(result.message);
    if (result.pm.submission === "accepted")
      ElMessage.success(result.message);
    else if (result.pm.submission === "rejected")
      ElMessage.error(result.errorMessage || "PM 手动 GTC 被拒绝");
    else
      ElMessage.warning(`${result.message}。请勿重复下单`);
    await refreshGtcOrders().catch(() => {});
    void context.accountStore.refreshBalance(account).catch(() => {});
  }
  catch (error) {
    await ElMessageBox.alert(error instanceof Error ? error.message : String(error), "PM GTC 手动下单");
  }
}
