/** [changmen 扩展] RAY 提交后的只读订单预览；不保存、绑单或参与拒单/补单判定。 */
import type { BetOption } from "@changmen/client-core/models/betOption";
import type { BetResult } from "@changmen/client-core/models/betResult";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import type { VenueOrder } from "@changmen/venue-browser/adapter/contract";
import type { OrderRow } from "@/types/order";
import type { RayOrderContext } from "./types";
import { shallowReactive } from "vue";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/api/client";
import { useUserStore } from "@/stores/userStore";
import { useAccountStore } from "@/stores/accountStore";
import { useOrderStore } from "@/stores/orderStore";
import { observedRayOrders } from "@/runtime/orderMonitoring/rayOrders";
import { toOrderDateKeyLocal } from "@/shared/orderLink";
import { matchRayVenueOrder } from "./match";

interface Preview {
  account: PlatformAccount;
  current: () => boolean;
  acceptedAt: number;
  task: RayOrderContext;
  matchId: string;
  itemId: string;
  previousIds: Set<string>;
  order?: VenueOrder;
}
const previews = shallowReactive(new Map<string, Preview>());
let generation = 0;
let wake: ((account: PlatformAccount) => void) | undefined;
const binding = (account: PlatformAccount) => JSON.stringify([account.gateway, account.token, account.currency]);

export function setRaySubmissionPreviewWake(callback?: (account: PlatformAccount) => void): void { wake = callback; }
export function resetRaySubmissionPreviews(): void { generation++; previews.clear(); wake = undefined; }

/** 捕获提交前身份；成功回执只登记任务，不等待查询，不修改 option/result。 */
export function beginRaySubmissionPreview(account: PlatformAccount, option: BetOption): ((result: BetResult) => void) | undefined {
  const user = useUserStore();
  const accounts = useAccountStore();
  const owner = String(user.userId || "");
  const linkId = Number(option.diagnosticLinkId);
  if (account.provider !== "RAY" || !owner || user.isLoggedIn === false || accounts.adminWorkspacePreview
    || !linkId || !account.accountId || option.loseOrder)
    return;
  const session = getAuthSessionVersion();
  const stamp = generation;
  const credentials = binding(account);
  const current = () => generation === stamp && isAuthSessionCurrent(session) && String(user.userId || "") === owner
    && user.isLoggedIn !== false && !accounts.adminWorkspacePreview
    && accounts.findAccount(account.accountId) === account && binding(account) === credentials;
  const submittedAt = Date.now();
  const previousIds = new Set(observedRayOrders(account)?.orders.map(order => order.orderId) ?? []);
  for (const rows of useOrderStore().orders.values()) {
    for (const row of rows) {
      if (row.Type === "RAY" && row.PlayerID === account.accountId && row.OrderID != null)
        previousIds.add(String(row.OrderID));
    }
  }
  const task: RayOrderContext = {
    key: `${owner}:${linkId}:${account.accountId}:${option.itemId}`, userId: owner, linkId,
    accountId: account.accountId, matchId: Number(option.matchId) || 0, betId: Number(option.betId) || 0,
    side: option.orderIndex === 2 ? "B" : "A", submittedAt,
    match: String(option.match?.title || ""), bet: String(option.bet?.getBetName() || ""),
    item: String(option.target === "Home" ? option.bet?.homeName || "" : option.bet?.awayName || ""),
    target: option.target, odds: Number(option.odds) || 0, betMoney: Math.round(Number(option.betMoney) || 0),
    anchorConfirmed: false, anchorProvider: "", anchorAccountId: 0, anchorBetMoney: 0, anchorOdds: 0,
    status: "binding", candidateCount: 0, pollCount: 0, updatedAt: submittedAt,
  };
  const matchId = String(option.matchId ?? "");
  const itemId = String(option.itemId ?? "");
  return (result) => {
    if (!result.success || !current())
      return;
    previews.set(task.key, { account, current, task, matchId, itemId, previousIds, acceptedAt: Date.now() });
    // 不把网络请求或观察异常传回下注调用。
    void Promise.resolve().then(() => { if (current()) wake?.(account); }).catch(() => {});
  };
}

export function pendingRaySubmissionPreviewAccounts(): PlatformAccount[] {
  return [...new Set([...previews.values()].filter(preview => !preview.order && preview.current()).map(preview => preview.account))];
}

export function retireRaySubmissionPreviews(rows: readonly OrderRow[]): void {
  const known = new Set(rows.filter(row => row.Type === "RAY" && !row.DisplayOnly).map(row => `${row.PlayerID}:${row.OrderID}`));
  for (const [key, preview] of previews) {
    if (!preview.current() || (preview.order && known.has(`${preview.account.accountId}:${preview.order.orderId}`)))
      previews.delete(key);
  }
}

function sameText(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
  const a = normalize(left), b = normalize(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

export function observeRaySubmissionPreviews(account: PlatformAccount, orders: readonly VenueOrder[], startedAt: number): void {
  const owned = [...previews.values()].filter(preview => preview.account === account && preview.current());
  const claimed = new Set(owned.map(preview => preview.order?.orderId).filter(Boolean));
  for (const preview of owned) {
    if (preview.order || startedAt < preview.acceptedAt)
      continue;
    const candidates = orders.filter(order => !claimed.has(order.orderId) && !preview.previousIds.has(order.orderId)
      && order.createAt >= preview.task.submittedAt - 1000
      && (order.venueItemId ? order.venueItemId === preview.itemId : sameText(preview.task.item, order.item))
      && (order.venueMatchId ? order.venueMatchId === preview.matchId : sameText(preview.task.match, order.match)));
    const matched = matchRayVenueOrder(preview.task, candidates);
    if (matched.kind === "matched") {
      claimed.add(matched.candidate.order.orderId);
      previews.set(preview.task.key, { ...preview, order: { ...matched.candidate.order } });
    }
  }
}

/** 纯展示投影；正式订单同账号同单号出现后自动替代预览，统计及业务 store 不变。 */
export function projectRaySubmissionPreviews(
  entries: ReadonlyArray<readonly [number, OrderRow[]]>, date: string, accountId: number,
): ReadonlyArray<readonly [number, OrderRow[]]> {
  const result = new Map(entries.map(([link, rows]) => [link, [...rows]]));
  let added = false;
  const known = new Set(entries.flatMap(([, rows]) => rows.filter(row => row.Type === "RAY")
    .map(row => `${row.PlayerID}:${row.OrderID}`)));
  for (const preview of previews.values()) {
    const { account, task, order } = preview;
    if (!preview.current() || !order || known.has(`${account.accountId}:${order.orderId}`)
      || (accountId && account.accountId !== accountId) || toOrderDateKeyLocal(task.linkId) !== date)
      continue;
    const rows = result.get(task.linkId) ?? [];
    rows.push({ DisplayOnly: true, Type: "RAY", PlayerID: account.accountId, OrderID: order.orderId, Link: task.linkId,
      Match: order.match, Bet: order.bet, Item: order.item, Odds: order.odds, BetMoney: order.betMoney,
      Money: order.money, CreateAt: order.createAt, Status: "RayConfirming",
      Player: { Platform: account.platformName || "RAY", UserName: account.playerName } });
    result.set(task.linkId, rows);
    added = true;
  }
  return added ? [...result].sort(([a], [b]) => b - a) : entries;
}
