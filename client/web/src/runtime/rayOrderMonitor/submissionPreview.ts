/** [changmen 扩展] RAY 提交后的只读订单预览；不保存、绑单或参与拒单/补单判定。 */
import type { BetOption } from "@changmen/client-core/models/betOption";
import type { BetResult } from "@changmen/client-core/models/betResult";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import type { VenueOrder } from "@changmen/venue-adapter/contract";
import type { OrderRow } from "@/types/order";
import type { RayOrderContext } from "./types";
import type { ArbBetPlaced } from "@/stores/betting/autoBet/phases/types";
import type { ArbLegSettleSnapshot } from "@/stores/betting/autoBet/phases/settleBothArbLegs";
import { shallowReactive } from "vue";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/api/client";
import { useUserStore } from "@/stores/userStore";
import { useAccountStore } from "@/stores/accountStore";
import { useOrderStore } from "@/stores/orderStore";
import { getProvider } from "@/runtime/venueAdapters";
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
  confirmation?: { rejected: boolean; pending: boolean; checkedAt: number };
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
  const waitsForArbCheck = option.diagnosticAttempt === "initial" || option.diagnosticAttempt === "retry";
  return (result) => {
    if (!result.success || !current())
      return;
    previews.set(task.key, { account, current, task, matchId, itemId, previousIds, acceptedAt: Date.now(),
      confirmation: waitsForArbCheck ? undefined : { rejected: false, pending: false, checkedAt: 0 } });
    // 不把网络请求或观察异常传回下注调用。
    void Promise.resolve().then(() => { if (current()) wake?.(account); }).catch(() => {});
  };
}

export function hasRaySubmissionPreviews(account: PlatformAccount): boolean {
  return [...previews.values()].some(preview => preview.account === account && preview.current());
}

export function retireRaySubmissionPreviews(rows: readonly OrderRow[]): void {
  const known = new Map(rows.filter(row => row.Type === "RAY" && !row.DisplayOnly).map(row => [`${row.PlayerID}:${row.OrderID}`, row]));
  for (const [key, preview] of previews) {
    const formal = preview.order && known.get(`${preview.account.accountId}:${preview.order.orderId}`);
    if (!preview.current() || (preview.confirmation && !preview.confirmation.pending && formal
      && (formal.Status === previewStatus(preview) || (!preview.confirmation.rejected && ["Win", "Lose", "Return"].includes(String(formal.Status))))))
      previews.delete(key);
  }
}

/** [changmen 扩展] 只接收原拒单检测结果供展示；不查询、不写回检测结果或业务订单。 */
export function finishRaySubmissionPreviewChecks(placed: Pick<ArbBetPlaced, "linkId" | "accountA" | "accountB" | "legA" | "legB">, settle: Pick<ArbLegSettleSnapshot, "rejectA" | "rejectB" | "pendingConfirmA" | "pendingConfirmB" | "ordersA" | "ordersB">): void {
  try {
    for (const preview of previews.values()) {
      if (!preview.current() || preview.task.linkId !== placed.linkId)
        continue;
      const sideA = placed.accountA === preview.account && placed.legA.target === preview.task.target;
      const sideB = placed.accountB === preview.account && placed.legB.target === preview.task.target;
      if (sideA === sideB)
        continue;
      const rejected = sideA ? settle.rejectA : settle.rejectB;
      const pending = sideA ? settle.pendingConfirmA : settle.pendingConfirmB;
      const orders = sideA ? settle.ordersA : settle.ordersB;
      const checked = orders.find(order => order.orderId === preview.order?.orderId);
      const order = preview.order ? { ...preview.order, ...(checked || {}), status: rejected ? "reject" as const : checked?.status ?? "none" as const } : undefined;
      previews.set(preview.task.key, { ...preview, order, confirmation: { rejected, pending, checkedAt: Date.now() } });
    }
  }
  catch { /* 展示交接失败不能影响拒单检测、补单或原下注收尾。 */ }
}

function previewStatus(preview: Preview): OrderRow["Status"] {
  if (!preview.confirmation || preview.confirmation.pending)
    return "RayConfirming";
  return preview.confirmation.rejected ? "Reject" : preview.order!.status[0]!.toUpperCase() + preview.order!.status.slice(1);
}

/** 预览查询直接读 adapter，不向 GTC/拒单检测共享的事实快照发布提前结果。 */
export async function readRaySubmissionPreviewOrders(account: PlatformAccount): Promise<VenueOrder[]> {
  return await getProvider(account)?.getOrders?.(account) ?? [];
}

function sameText(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
  const a = normalize(left), b = normalize(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

export function observeRaySubmissionPreviews(account: PlatformAccount, orders: readonly VenueOrder[], startedAt: number): void {
  const owned = [...previews.values()].filter(preview => preview.account === account && preview.current());
  for (const preview of owned) {
    if (startedAt < preview.acceptedAt || (preview.confirmation && startedAt <= preview.confirmation.checkedAt))
      continue;
    const claimed = new Set(owned.filter(other => other !== preview).map(other => other.order?.orderId).filter(Boolean));
    const candidates = orders.filter(order => !claimed.has(order.orderId) && !preview.previousIds.has(order.orderId)
      && order.createAt >= preview.task.submittedAt - 1000
      && (order.venueItemId ? order.venueItemId === preview.itemId : sameText(preview.task.item, order.item))
      && (order.venueMatchId ? order.venueMatchId === preview.matchId : sameText(preview.task.match, order.match)));
    const matched = matchRayVenueOrder(preview.task, candidates);
    const order = preview.order ? candidates.find(order => order.orderId === preview.order!.orderId)
      : matched.kind === "matched" ? matched.candidate.order : undefined;
    if (order) {
      // 慢响应不能把已观察到的终态回退为未结算。
      const terminal = preview.order && ["win", "lose", "return", "reject"].includes(preview.order.status);
      previews.set(preview.task.key, { ...preview, order: terminal ? preview.order : { ...order } });
    }
  }
}

/** 纯展示投影；正式订单同账号同单号出现后自动替代预览，统计及业务 store 不变。 */
export function projectRaySubmissionPreviews(
  entries: ReadonlyArray<readonly [number, OrderRow[]]>, date: string, accountId: number,
): ReadonlyArray<readonly [number, OrderRow[]]> {
  const result = new Map(entries.map(([link, rows]) => [link, [...rows]]));
  let added = false;
  // 正常同步可能早于拒单检测完成：只在投影里遮盖状态，原订单保持原样。
  for (const preview of previews.values()) {
    if (!preview.current() || !preview.order || (accountId && preview.account.accountId !== accountId))
      continue;
    for (const [link, rows] of result) {
      const index = rows.findIndex(row => row.Type === "RAY" && row.PlayerID === preview.account.accountId && String(row.OrderID) === preview.order!.orderId);
      if (index < 0)
        continue;
      if (preview.confirmation && !preview.confirmation.pending && !preview.confirmation.rejected
        && ["Win", "Lose", "Return"].includes(String(rows[index]!.Status)))
        continue;
      const status = previewStatus(preview);
      if (status !== rows[index]!.Status) {
        rows[index] = { ...rows[index]!, DisplayOnly: true, Status: status };
        result.set(link, rows); added = true;
      }
    }
  }
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
      Money: order.money, CreateAt: order.createAt, Status: previewStatus(preview),
      Player: { Platform: account.platformName || "RAY", UserName: account.playerName } });
    result.set(task.linkId, rows);
    added = true;
  }
  return added ? [...result].sort(([a], [b]) => b - a) : entries;
}
