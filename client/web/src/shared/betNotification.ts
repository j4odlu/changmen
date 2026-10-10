import type { BetOption } from "@changmen/client-core/models/betOption";
import type { PlatformAccount } from "@/models/platformAccount";
import { ElNotification } from "element-plus";
import { bettingDetailHtml, bettingLoadingMessageHtml, bettingNotifyAccountLine, bettingResultMessageHtml } from "./a8Notify";

export interface BetNotice {
  type: "success" | "warning" | "error";
  message: string;
}

export interface BetNotificationDisplay {
  provider: string;
  accountLine: string;
  detailHtml: string;
}

/** [changmen 扩展] 所有下单路径共用通知；展示异常不能改变下单结果。 */
export function startBetNotification(display: BetNotificationDisplay): { close: () => void } {
  try {
    const loading = ElNotification({
      title: "", message: bettingLoadingMessageHtml(display.provider, display.accountLine, display.detailHtml),
      dangerouslyUseHTMLString: true, position: "top-right", duration: 10_000,
      customClass: `notification loading ${display.provider}`,
    });
    return { close: () => { try { loading.close(); } catch { /* 提示清理异常不影响下单 */ } } };
  }
  catch { return { close: () => {} }; }
}

export function showBetResultNotification(
  display: BetNotificationDisplay,
  result: { type: BetNotice["type"]; messageHtml: string; statusSuffix?: string },
  seconds = 10,
): void {
  try {
    ElNotification({
      title: "", message: bettingResultMessageHtml(display.provider, display.accountLine, display.detailHtml, result.messageHtml, result.statusSuffix),
      type: result.type, dangerouslyUseHTMLString: true, position: "top-right",
      customClass: `notification ${display.provider}`, duration: seconds === 0 ? 3000 : seconds * 1000,
    });
  }
  catch { /* 提示异常不能改变下单结果 */ }
}

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** [changmen 扩展] 包装独立下单调用；调用方提供状态文字，通知层不读取下单模式。 */
export async function notifyBet<T>(
  account: PlatformAccount,
  option: BetOption,
  run: () => Promise<T>,
  present: (result: T) => BetNotice,
  seconds = 10,
  context?: { matchTitle?: string; betName?: string },
): Promise<T> {
  const display: BetNotificationDisplay = { provider: account.provider, accountLine: "", detailHtml: "" };
  try {
    display.accountLine = bettingNotifyAccountLine(account);
    display.detailHtml = bettingDetailHtml({
      matchTitle: context?.matchTitle ?? option.match?.title,
      betName: context?.betName ?? option.bet?.getBetName(),
      target: option.target, itemOdds: option.item?.getOdds(option.target),
      betMoney: option.betMoney, odds: option.odds, betCount: option.betCount,
    });
  }
  catch { /* 展示数据异常不能阻断下单 */ }
  const loading = startBetNotification(display);
  let notice: BetNotice | undefined;
  try {
    const result = await run();
    try { notice = present(result); }
    catch { /* 展示异常不改变已取得的下单结果 */ }
    return result;
  }
  catch (error) {
    notice = { type: "warning", message: `${error instanceof Error ? error.message : String(error)}；下单流程未完成，请核对订单状态` };
    throw error;
  }
  finally {
    loading.close();
    if (notice) showBetResultNotification(display, { type: notice.type, messageHtml: `<p>${escapeText(notice.message)}</p>` }, seconds);
  }
}
