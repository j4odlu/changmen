/** [changmen 扩展] 提交后真实 RAY 订单的只读展示。 */
import type { BetOption } from "@changmen/client-core/models/betOption";
import type { BetResult } from "@changmen/client-core/models/betResult";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import type { VenueOrder } from "@changmen/venue-browser/adapter/contract";
import type { OrderRow } from "@/types/order";
import { shallowReactive } from "vue";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/api/client";
import { useUserStore } from "@/stores/userStore";
import { useAccountStore } from "@/stores/accountStore";
import { useOrderStore } from "@/stores/orderStore";
import { observedRayOrders } from "@/runtime/orderMonitoring/rayOrders";
import { toOrderDateKeyLocal } from "@/shared/orderLink";

interface Submission {
  account: PlatformAccount;
  current: () => boolean;
  acceptedAt: number;
  linkId: number;
  matchId: string;
  itemId: string;
  betMoney: number;
  odds: number;
  previousIds?: Set<string>;
  orderId?: string;
}
const submissions = shallowReactive(new Map<string, Submission>());
// 只存场馆实际返回的订单，以账号和 order_number 标识；提交记录本身不是订单。
const ordersById = shallowReactive(new Map<string, VenueOrder>());
const BASELINE_MAX_AGE_MS = 30_000;
let generation = 0;
let wake: ((account: PlatformAccount) => void) | undefined;
const binding = (account: PlatformAccount) => JSON.stringify([account.gateway, account.token, account.currency]);
const orderKey = (account: PlatformAccount, id: string) => `${account.accountId}:${id}`;
const terminal = (order?: VenueOrder) => Boolean(order && ["reject", "win", "lose", "return"].includes(order.status));

export function setRaySubmissionDisplayWake(callback?: (account: PlatformAccount) => void): void { wake = callback; }
export function resetRaySubmissionDisplays(): void { generation++; submissions.clear(); ordersById.clear(); wake = undefined; }

/** 只捕获提交前已完成的正常查单快照，不增加前置请求或等待，不修改下注参数/回执。 */
export function beginRaySubmissionDisplay(account: PlatformAccount, option: BetOption): ((result: BetResult) => void) | undefined {
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
  const snapshot = observedRayOrders(account);
  // 原 adapter 的空数组也可能来自非 200 响应，不能当作“场馆没有旧单”的证据。
  // 缺失、空白或陈旧快照不用于认领新单；订单栏中的部分记录也不能充当完整基线。
  const previousIds = snapshot && snapshot.orders.length > 0 && snapshot.startedAt <= submittedAt
    && submittedAt - snapshot.startedAt < BASELINE_MAX_AGE_MS
    ? new Set(snapshot.orders.map(order => String(order.orderId))) : undefined;
  if (previousIds) {
    for (const rows of useOrderStore().orders.values()) {
      for (const row of rows) {
        if (row.Type === "RAY" && row.PlayerID === account.accountId && row.OrderID != null)
          previousIds.add(String(row.OrderID));
      }
    }
    for (const other of submissions.values()) {
      if (other.account === account && other.current() && other.orderId)
        previousIds.add(other.orderId);
    }
  }
  const key = `${owner}:${linkId}:${account.accountId}:${option.itemId}`;
  const submission: Submission = {
    account, current, linkId, acceptedAt: 0, previousIds,
    matchId: String(option.matchId ?? ""), itemId: String(option.itemId ?? ""),
    betMoney: Math.round(Number(option.betMoney) || 0), odds: Number(option.odds) || 0,
  };
  return (result) => {
    if (!result.success || !current())
      return;
    // 同账号有尚未定位的提交时，不能靠遍历顺序把一个新单分给其中某次提交。
    for (const [otherKey, other] of submissions) {
      if (other.account === account && other.current() && !other.orderId) {
        submissions.set(otherKey, { ...other, previousIds: undefined });
        submission.previousIds = undefined;
      }
    }
    submissions.set(key, { ...submission, acceptedAt: Date.now() });
    void Promise.resolve().then(() => { if (current()) wake?.(account); }).catch(() => {});
  };
}

export function pendingRaySubmissionDisplayAccounts(): PlatformAccount[] {
  return [...new Set([...submissions.values()].filter(submission => submission.current()
    && !terminal(submission.orderId ? ordersById.get(orderKey(submission.account, submission.orderId)) : undefined))
    .map(submission => submission.account))];
}

export function retireRaySubmissionDisplays(rows: readonly OrderRow[]): void {
  const known = new Set(rows.filter(row => row.Type === "RAY" && !row.DisplayOnly).map(row => `${row.PlayerID}:${row.OrderID}`));
  for (const [key, submission] of submissions) {
    // 正常查单已将此 Link 的订单交给正式列表；缺基线的提交也应停止展示查询。
    const persisted = rows.some(row => row.Type === "RAY" && !row.DisplayOnly
      && row.PlayerID === submission.account.accountId && row.Link === submission.linkId && row.OrderID != null);
    if (!submission.current() || persisted || (submission.orderId && known.has(orderKey(submission.account, submission.orderId)))) {
      submissions.delete(key);
      if (submission.orderId)
        ordersById.delete(orderKey(submission.account, submission.orderId));
    }
  }
}

function matchesSubmission(submission: Submission, order: VenueOrder): boolean {
  return Boolean(submission.matchId && submission.itemId && order.venueMatchId === submission.matchId
    && order.venueItemId === submission.itemId && submission.betMoney > 0 && submission.odds > 0
    && Number.isFinite(order.betMoney) && Math.abs(order.betMoney - submission.betMoney) < 0.005
    && Number.isFinite(order.odds) && Math.abs(order.odds - submission.odds) < 0.000001);
}

export function observeRaySubmissionDisplays(account: PlatformAccount, orders: readonly VenueOrder[], startedAt: number): void {
  const owned = [...submissions.entries()].filter(([, submission]) => submission.account === account && submission.current());
  for (const [key, submission] of owned) {
    if (startedAt < submission.acceptedAt)
      continue;
    if (submission.orderId) {
      const id = orderKey(account, submission.orderId);
      const order = orders.find(order => order.provider === "RAY" && order.orderId === submission.orderId);
      if (order && !terminal(ordersById.get(id)))
        ordersById.set(id, { ...order });
      continue;
    }
    if (!submission.previousIds)
      continue;
    // 必须只有一个新增场馆单号，且精确核对原生身份及下注数值；没有评分、文本包含或时钟猜配。
    const added = orders.filter(order => order.provider === "RAY" && String(order.orderId ?? "").trim()
      && !submission.previousIds!.has(order.orderId));
    if (added.length > 1) {
      submissions.set(key, { ...submission, previousIds: undefined });
      continue;
    }
    if (added.length !== 1)
      continue;
    const order = added[0]!;
    if (!matchesSubmission(submission, order) || ordersById.has(orderKey(account, order.orderId)))
      continue;
    ordersById.set(orderKey(account, order.orderId), { ...order });
    submissions.set(key, { ...submission, orderId: order.orderId });
  }
}

/** 真实单号只显示一行；正式列表优先。DisplayOnly 仅限制未持久化行的业务动作及统计。 */
export function projectRaySubmissionDisplays(
  entries: ReadonlyArray<readonly [number, OrderRow[]]>, date: string, accountId: number,
): ReadonlyArray<readonly [number, OrderRow[]]> {
  const result = new Map(entries.map(([link, rows]) => [link, [...rows]]));
  let added = false;
  const known = new Set(entries.flatMap(([, rows]) => rows.filter(row => row.Type === "RAY")
    .map(row => `${row.PlayerID}:${row.OrderID}`)));
  for (const submission of submissions.values()) {
    const { account, linkId, orderId } = submission;
    const order = orderId ? ordersById.get(orderKey(account, orderId)) : undefined;
    if (!submission.current() || !order || known.has(orderKey(account, order.orderId))
      || (accountId && account.accountId !== accountId) || toOrderDateKeyLocal(linkId) !== date)
      continue;
    const rows = result.get(linkId) ?? [];
    rows.push({ DisplayOnly: true, Type: "RAY", PlayerID: account.accountId, OrderID: order.orderId, Link: linkId,
      RayInternalOrderId: order.rayInternalOrderId,
      Match: order.match, Bet: order.bet, Item: order.item, Odds: order.odds, BetMoney: order.betMoney,
      Money: order.money, CreateAt: order.createAt,
      Status: (order.status[0]!.toUpperCase() + order.status.slice(1)) as OrderRow["Status"],
      Player: { Platform: account.platformName || "RAY", UserName: account.playerName } });
    known.add(orderKey(account, order.orderId));
    result.set(linkId, rows);
    added = true;
  }
  return added ? [...result].sort(([a], [b]) => b - a) : entries;
}
