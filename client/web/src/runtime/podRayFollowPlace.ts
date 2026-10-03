/** [changmen 扩展] 足球 RAY 单腿；采集凭证不用于下注，使用显式选择的账号。 */
import { BetOption } from "@changmen/client-core/models/betOption";
import type { PlatformAccount } from "@/models/platformAccount";
import type { VenueOrder } from "@changmen/venue-adapter/contract";
import type { PodPmFollowPlaceTicket } from "@/runtime/podPmFollowPlace";
import { evaluatePodOutcomeGate, type PodOutcomeGateEntry } from "@/runtime/podYabo/gate";
import { podYaboDailyLossBlocked } from "@/runtime/podYabo/loss";
import { getProvider } from "@/runtime/providers";
import { useAccountStore } from "@/stores/accountStore";
import { useSportOddsStore } from "@/stores/sportOddsStore";
import { useUserStore } from "@/stores/userStore";
import { reservePodBetExecution, finalizePodBetExecution } from "@/api/podBetExecution";
import { saveOrders } from "@/api/order";
import { getExchange } from "@changmen/shared/currency";
import { readPodBetSettings } from "@/runtime/podBetSettings";

export type PodRayFollowPlaceTicket = Omit<PodPmFollowPlaceTicket, "pmMatchId"> & {
  rayMatchId: string; submitBefore?: number;
};

export function listRayFollowAccounts(accounts: PlatformAccount[], ids?: number[]): PlatformAccount[] {
  const selected = ids ? new Set(ids) : null;
  return accounts.filter(a => a.provider === "RAY" && (!selected || selected.has(Number(a.accountId))));
}

export function podRayFollowPlaceBlock(ticket: PodRayFollowPlaceTicket): string | null {
  if (ticket.fixtureStatus !== "matched") return "场未对上";
  if (ticket.market.status !== "matched" || ticket.market.venue !== "RAY") return "无 RAY 盘";
  if (!ticket.rayMatchId || !ticket.market.oid) return "RAY 盘口不完整";
  if (ticket.market.locked) return "RAY 锁盘";
  if (!['home', 'away', 'draw', 'over', 'under'].includes(String(ticket.market.boardSide))) return "无投注方向";
  if (ticket.quote.status !== "ok") return ticket.quote.status === "spike" ? "EV 异常" : "RAY 价不够";
  if (!(Number(ticket.stake) > 0)) return "RAY金额未设";
  if (!ticket.accountIds?.some(id => Number(id) > 0)) return "请选择 RAY 账号";
  if (ticket.auto && ticket.fixtureBasis !== "confirmed") return "身份未确认";
  if (ticket.auto && !ticket.market.fromLive) return "等实时价";
  if (ticket.auto && ticket.submitBefore && Date.now() >= ticket.submitBefore) return "信号已过期或比赛已开赛";
  return null;
}

export function rayGateEntry(ticket: PodRayFollowPlaceTicket): PodOutcomeGateEntry {
  return { obMid: ticket.rayMatchId, marketCode: ticket.market.marketCode, boardSide: ticket.market.boardSide };
}

export function pickPodRayAutoTicket(
  tickets: PodRayFollowPlaceTicket[], skipped: Iterable<string>, entries: PodOutcomeGateEntry[],
  cap: { todayProfit: number; openStake: number; maxDailyLoss: number },
): PodRayFollowPlaceTicket | null {
  if (podYaboDailyLossBlocked(cap)) return null;
  const seen = new Set(skipped);
  return tickets.filter(t => !seen.has(t.id) && t.fixtureBasis === "confirmed" && t.market.fromLive
    && !podRayFollowPlaceBlock(t) && evaluatePodOutcomeGate(rayGateEntry(t), entries).allow)
    .sort((a, b) => Number(b.quote.evPercent) - Number(a.quote.evPercent))[0] || null;
}

type RayBindTask = {
  key: string; ticket: PodRayFollowPlaceTicket; accountId: number; at: number;
  beforeIds: string[]; match: string; bet: string; item: string;
  venueStake: number; exchange: number; accepted: boolean;
};

function storageKey(): string {
  const user = useUserStore();
  return `changmen:ray-football-bind:v1:${String(user.userId || user.userName || "")}`;
}

export function readRayFootballBindTasks(scope = storageKey()): RayBindTask[] {
  try {
    const rows = JSON.parse(localStorage.getItem(scope) || "[]");
    return Array.isArray(rows) ? rows.filter(r => r && typeof r.key === "string"
      && r.ticket?.rayMatchId && Array.isArray(r.beforeIds) && r.at > 0 && r.venueStake > 0) : [];
  }
  catch { return []; }
}

function writeTasks(rows: RayBindTask[], scope = storageKey()): void {
  // 提交前必须能保存恢复任务；失败时不调用场馆。
  localStorage.setItem(scope, JSON.stringify(rows));
}

function upsertTask(task: RayBindTask, scope: string): void {
  const rows = readRayFootballBindTasks(scope);
  writeTasks([...rows.filter(r => r.key !== task.key), task], scope);
}

export function matchRayFootballOrder(task: RayBindTask, orders: VenueOrder[]): VenueOrder | null {
  const previous = new Set(task.beforeIds);
  const rows = orders.filter(o => !previous.has(String(o.orderId)) && o.orderId
    && Number(o.createAt) >= task.at - 2000 && Number(o.createAt) <= task.at + 60_000
    && String(o.match).trim() === task.match && String(o.bet).trim() === task.bet
    && String(o.item).trim() === task.item && Math.abs(Number(o.betMoney) - task.venueStake) < 0.01);
  return rows.length === 1 ? rows[0] : null;
}

function taggedOrder(task: RayBindTask, order: VenueOrder): VenueOrder {
  return { ...order, domain: "sports", sport: "football",
    source: task.ticket.auto ? "football-pod-auto" : task.ticket.id.startsWith("board:") ? "football-board" : "football-pod",
    podClientId: task.ticket.id, podRayMatchId: task.ticket.rayMatchId,
    podMarketCode: task.ticket.market.marketCode, podBoardSide: task.ticket.market.boardSide || undefined };
}

let syncing = false;
export async function syncRayFootballOrders(): Promise<void> {
  if (syncing) return;
  syncing = true;
  const scope = storageKey();
  try {
    const accounts = useAccountStore();
    const { getOrderList } = await import("@/api/order");
    const existing = await getOrderList({ domain: "sports", sport: "football", pageIndex: 1, pageSize: 1024 });
    const saved = (existing?.list || []).filter(r => r.Type === "RAY" && r.Domain === "sports" && r.Sport === "football");
    const tasks = readRayFootballBindTasks(scope);
    const ids = new Set([...tasks.map(t => t.accountId), ...saved.map(r => Number(r.PlayerID))]);
    for (const id of ids) {
      const account = accounts.findAccount(id);
      if (!account || account.provider !== "RAY") continue;
      const provider = getProvider(account);
      if (!provider?.getOrders) continue;
      try {
        const orders = await provider.getOrders(account);
        if (storageKey() !== scope) return;
        for (const task of tasks.filter(t => t.accountId === id)) {
          const order = matchRayFootballOrder(task, orders);
          if (!order) continue;
          await saveOrders(account, [taggedOrder(task, order)]);
          writeTasks(readRayFootballBindTasks(scope).filter(t => t.key !== task.key), scope);
        }
        for (const row of saved.filter(r => Number(r.PlayerID) === id)) {
          const order = orders.find(o => String(o.orderId) === String(row.OrderID));
          if (order) await saveOrders(account, [{ ...order, domain: "sports", sport: "football",
            source: row.Source, podClientId: row.PodClientId, podRayMatchId: row.PodRayMatchId,
            podMarketCode: row.PodMarketCode, podBoardSide: row.PodBoardSide }]);
        }
      }
      catch (err) { console.warn("[football] RAY order sync failed", err); }
    }
  }
  finally { syncing = false; }
}

// [changmen 扩展] 复用场馆预检时隔离电竞 fo，RAY 平局仍由 oddId 唯一选择。
class RayFootballBetOption extends BetOption {
  override updateOdds(odds: number) {
    useSportOddsStore().saveMany("RAY", [{ id: this.itemId, odds }]);
  }
}

let placing = false;
export async function placePodRayFollowBet(ticket: PodRayFollowPlaceTicket): Promise<{ ok: boolean; message: string }> {
  const block = podRayFollowPlaceBlock(ticket);
  if (block) return { ok: false, message: block };
  if (placing) return { ok: false, message: "RAY 下单中" };
  const store = useAccountStore();
  const accounts = listRayFollowAccounts(store.accounts, ticket.accountIds || []);
  if (!accounts.length) return { ok: false, message: "未找到已选择的 RAY 账号" };
  const notes: string[] = [], failures: string[] = [];
  const scope = storageKey();
  placing = true;
  try {
    for (const account of accounts) {
      const key = `${ticket.id}#RAY#${account.accountId}`;
      if (readRayFootballBindTasks().some(t => t.key === key)) {
        failures.push(`${account.playerName}:已有待确认提交`); continue;
      }
      if (!account.gateway || !account.token) { failures.push(`${account.playerName}:凭证不完整`); continue; }
      const side = ticket.market.boardSide === "away" || ticket.market.boardSide === "under" ? "Away" : "Home";
      const option = new RayFootballBetOption("RAY", ticket.rayMatchId, String(ticket.market.betId || ""),
        ticket.market.oid, ticket.stake, side, ticket.quote.quote);
      // 场馆预检允许涨价；足球策略必须再次校验 EV 上限。
      const checked = await store.checkBetting(account, option);
      const live = Number(checked.odds);
      if (!checked.data || checked.checkError || !(live > 1) || live < ticket.quote.minObOdds
        || (ticket.quote.maxObOdds > 1 && live > ticket.quote.maxObOdds)) {
        failures.push(`${account.playerName}:${checked.checkError || "预检赔率不在策略范围"}`); continue;
      }
      const raw = checked.response as { match_name?: string; match_stage?: string; group_name?: string; name?: string };
      const provider = getProvider(account);
      if (!provider?.getOrders || !raw.match_name || !raw.group_name || !raw.name) {
        failures.push(`${account.playerName}:缺少订单绑定信息`); continue;
      }
      let before: VenueOrder[];
      try { before = await provider.getOrders(account); }
      catch { failures.push(`${account.playerName}:提交前订单查询失败`); continue; }
      if (storageKey() !== scope) { failures.push("登录用户已切换"); break; }
      let leaseToken = "";
      if (ticket.auto) {
        const lease = await reservePodBetExecution({ alertId: ticket.id, venue: "RAY", playerId: account.accountId });
        if (!lease.acquired) { failures.push(`${account.playerName}:已由其他页面处理`); continue; }
        leaseToken = lease.leaseToken;
      }
      const task: RayBindTask = { key, ticket, accountId: account.accountId, at: Date.now(),
        beforeIds: before.map(o => String(o.orderId)), match: raw.match_name.trim(),
        bet: `${raw.match_stage || ""} ${raw.group_name}`.trim(), item: raw.name.trim(),
        venueStake: Math.round(checked.betMoney), exchange: getExchange(account.currency), accepted: false };
      try { upsertTask(task, scope); }
      catch { failures.push(`${account.playerName}:无法保存提交恢复任务`); continue; }
      const settings = ticket.auto ? readPodBetSettings() : null;
      const paused = settings && (!settings.enabled || !settings.autoPlace || !(settings.rayStake > 0)
        || !settings.rayFollowAccountIds.includes(account.accountId));
      const lateBlock = storageKey() !== scope ? "登录用户已切换" : paused ? "RAY 自动跟单已暂停或账号已取消" : podRayFollowPlaceBlock(ticket);
      if (lateBlock) {
        writeTasks(readRayFootballBindTasks(scope).filter(t => t.key !== key), scope);
        if (leaseToken) await finalizePodBetExecution({ leaseToken, state: "failed", message: lateBlock }).catch(() => {});
        failures.push(`${account.playerName}:${lateBlock}`); continue;
      }
      let result;
      try { result = await store.betting(account, checked, 0, { requirePreparedQuote: true }); }
      catch (err) {
        if (leaseToken) await finalizePodBetExecution({ leaseToken, state: "unknown", message: String(err) }).catch(() => {});
        failures.push(`${account.playerName}:结果未知，等待回查`); continue;
      }
      if (!result.success) {
        const unknown = result.response == null;
        if (!unknown) writeTasks(readRayFootballBindTasks(scope).filter(t => t.key !== key), scope);
        if (leaseToken) await finalizePodBetExecution({ leaseToken, state: unknown ? "unknown" : "failed", message: result.message || undefined }).catch(() => {});
        failures.push(`${account.playerName}:${unknown ? "结果未知，等待回查" : result.message}`); continue;
      }
      // POST 成功后即受理；绑单/落库失败不能把成功伪装成可重试失败。
      try { upsertTask({ ...task, accepted: true }, scope); } catch { /* 提交前的任务仍可恢复 */ }
      if (leaseToken) await finalizePodBetExecution({ leaseToken, state: "accepted", message: "RAY 已受理，回查订单号" }).catch(() => {});
      notes.push(`${account.playerName}:已受理`);
    }
    await syncRayFootballOrders().catch(() => {});
  }
  catch (err) { failures.push(err instanceof Error ? err.message : String(err)); }
  finally { placing = false; }
  return { ok: notes.length > 0, message: [...notes, ...failures].join("；") || "RAY 下单失败" };
}
