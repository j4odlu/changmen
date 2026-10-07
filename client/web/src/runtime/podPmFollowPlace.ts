/**
 * POD 跟单 → Polymarket 单腿。旁路模块；不影响 OB podFollowPlace。
 */
import { BetOption } from "@changmen/client-core/models/betOption";
import type { BetSide } from "@changmen/client-core/models/match";
import type { PlatformAccount } from "@/models/platformAccount";
import type { PodFixtureMatchBasis } from "@/runtime/podFixtureMatch";
import type { PodMarketMatch, PodObQuoteCompare } from "@/runtime/podMarketMatch";
import { evaluatePodOutcomeGate, podOutcomeGateEntryFrom, type PodOutcomeGateEntry } from "@/runtime/podYabo/gate";
import { podYaboDailyLossBlocked } from "@/runtime/podYabo/loss";
import { useUserStore } from "@/stores/userStore";
import { useAccountStore } from "@/stores/accountStore";
import { useFootballOrderStore } from "@/stores/footballOrderStore";
import { finalizePodBetExecution, reservePodBetExecution } from "@/api/podBetExecution";
import {
  ensurePmVaultForAccounts,
  hasVault,
  mergeVaultKeysIntoAccounts,
  migrateTokenPrivateKeysToVault,
  normalizePmVaultUserId,
} from "@/security/pmVault";

const PM = "Polymarket" as const;

export type PodPmFollowPlaceTicket = {
  id: string;
  /** 用户计划下注金额，统一按 RMB/CNY 口径；checkBetting 会换成 PM 场馆 USDC。 */
  stake: number;
  fixtureStatus: string;
  fixtureBasis?: PodFixtureMatchBasis;
  pmMatchId?: string;
  home?: string;
  away?: string;
  sideLabel?: string;
  marketLabel?: string;
  auto?: boolean;
  accountIds?: number[];
  market: Pick<PodMarketMatch, "status" | "venue" | "locked" | "oid" | "betId" | "quote" | "marketCode" | "boardSide" | "boardLine" | "fromLive">;
  quote: PodObQuoteCompare;
};

function pmSideFromBoardSide(side: PodPmFollowPlaceTicket["market"]["boardSide"]): BetSide | null {
  if (side === "home" || side === "over")
    return "Home";
  if (side === "away" || side === "under")
    return "Away";
  return null;
}

export function listPmFollowAccounts(
  accounts: PlatformAccount[],
  accountIds: number[] = [],
): PlatformAccount[] {
  const ids = accountIds
    .map(id => Math.round(Number(id) || 0))
    .filter(id => id > 0);
  const selected = ids.length ? new Set(ids) : null;
  return accounts.filter(acc => (
    acc.provider === PM
    && (!selected || selected.has(Number(acc.accountId) || 0))
  ));
}

function normalizedAccountIds(ids: unknown): number[] {
  return Array.isArray(ids)
    ? ids.map(id => Math.round(Number(id) || 0)).filter(id => id > 0)
    : [];
}

export function podPmFollowPlaceBlock(ticket: PodPmFollowPlaceTicket): string | null {
  if (ticket.fixtureStatus !== "matched")
    return "场未对上";
  if (ticket.market.status !== "matched")
    return "盘未对上";
  if (String(ticket.market.venue || "") !== PM)
    return "无 PM 盘";
  if (!String(ticket.market.oid || "").trim())
    return "无 PM token";
  if (!String(ticket.market.betId || "").trim())
    return "无 PM condition_id";
  if (String(ticket.market.betId || "").trim() === String(ticket.market.oid || "").trim())
    return "PM condition_id 异常";
  if (ticket.market.locked)
    return "PM 锁盘";
  if (!pmSideFromBoardSide(ticket.market.boardSide))
    return "PM 暂不支持平局";
  if (ticket.quote.status !== "ok") {
    if (ticket.quote.status === "spike")
      return "EV 异常";
    return "PM 价不够";
  }
  if (!(Number(ticket.stake) > 0))
    return "PM金额未设";
  if (!normalizedAccountIds(ticket.accountIds).length)
    return "请选择 PM 账号";
  return null;
}

export function podPmAutoSkipReason(
  ticket: PodPmFollowPlaceTicket,
  placedIds: Iterable<string> = [],
  placedEntries: Iterable<PodOutcomeGateEntry> = [],
  cap: { todayProfit?: number; openStake?: number; maxDailyLoss?: number } = {},
): string | null {
  if (podYaboDailyLossBlocked({
    todayProfit: Number(cap.todayProfit) || 0,
    openStake: Number(cap.openStake) || 0,
    maxDailyLoss: Number(cap.maxDailyLoss) || 0,
  }))
    return "触及当日亏损上限";
  if (new Set(placedIds).has(ticket.id))
    return "已下过";
  if (ticket.fixtureBasis !== "confirmed")
    return "身份未确认";
  if (!ticket.market.fromLive)
    return "等实时价";
  const block = podPmFollowPlaceBlock(ticket);
  if (block)
    return block;
  const gate = evaluatePodOutcomeGate(podOutcomeGateEntryFrom({
    obMid: ticket.pmMatchId,
    market: ticket.market,
  }), [...placedEntries]);
  if (!gate.allow)
    return gate.reason || "同场闸门";
  return null;
}

export function pickPodPmAutoTicket(
  tickets: PodPmFollowPlaceTicket[],
  placedIds: Iterable<string>,
  placedEntries: Iterable<PodOutcomeGateEntry> = [],
  cap: { todayProfit?: number; openStake?: number; maxDailyLoss?: number } = {},
): PodPmFollowPlaceTicket | null {
  const ready: PodPmFollowPlaceTicket[] = [];
  for (const ticket of tickets) {
    if (podPmAutoSkipReason(ticket, placedIds, placedEntries, cap) != null)
      continue;
    ready.push(ticket);
  }
  ready.sort((a, b) => (Number(b.quote.evPercent) || 0) - (Number(a.quote.evPercent) || 0));
  return ready[0] || null;
}

function pickPmAccounts(ticket: PodPmFollowPlaceTicket): PlatformAccount[] {
  const store = useAccountStore();
  return listPmFollowAccounts(store.accounts, normalizedAccountIds(ticket.accountIds));
}

export async function ensurePmFootballAccountsHaveVaultKeys(): Promise<string | null> {
  const store = useAccountStore();
  const user = useUserStore();
  if (!user.userId && user.isLoggedIn)
    await user.fetchUserInfo();
  const uid = normalizePmVaultUserId(user.userId);
  if (!uid || !(await hasVault(uid)))
    return null;
  const unlocked = await ensurePmVaultForAccounts(uid, store.accounts.filter(a => String(a.provider) === "Polymarket"));
  if (!unlocked)
    return "请先解锁本机钱包";
  mergeVaultKeysIntoAccounts(store.accounts, uid);
  const migrated = await migrateTokenPrivateKeysToVault(store.accounts, uid);
  if (migrated > 0)
    void store.saveAccounts();
  return null;
}

export async function placePodPmFollowBet(ticket: PodPmFollowPlaceTicket): Promise<{ ok: boolean; message: string }> {
  const block = podPmFollowPlaceBlock(ticket);
  if (block)
    return { ok: false, message: block };

  const vaultBlock = await ensurePmFootballAccountsHaveVaultKeys();
  if (vaultBlock)
    return { ok: false, message: vaultBlock };

  const accounts = pickPmAccounts(ticket);
  if (!accounts.length)
    return { ok: false, message: "请选择 PM 账号" };

  const side = pmSideFromBoardSide(ticket.market.boardSide);
  const tokenId = String(ticket.market.oid || "").trim();
  const conditionId = String(ticket.market.betId || "").trim();
  if (!side || !tokenId || !conditionId)
    return { ok: false, message: "PM 盘口不完整" };

  const orders = useFootballOrderStore();
  const accountStore = useAccountStore();
  const okNotes: string[] = [];
  const failNotes: string[] = [];
  const planStakeCny = Number(ticket.stake);
  const odds = Number(ticket.quote.quote) || Number(ticket.market.quote) || 0;
  const matchId = String(ticket.pmMatchId || ticket.id || "").trim();

  for (const account of accounts) {
    const accountId = Number(account.accountId) || 0;
    const label = String(account.playerName || accountId || "PM账号").trim() || "PM账号";
    const option = new BetOption(PM, matchId, conditionId, tokenId, planStakeCny, side, odds);
    const checked = await accountStore.checkBetting(account, option, { pmQuoteScope: "sport" });
    if (!checked.data) {
      failNotes.push(`${label}:${checked.checkError || "预检失败"}`);
      continue;
    }
    let leaseToken = "";
    if (ticket.auto === true) {
      try {
        const lease = await reservePodBetExecution({ alertId: ticket.id, venue: PM, playerId: accountId });
        if (!lease.acquired) {
          failNotes.push(`${label}:已由其他页面处理(${lease.state || "reserved"})`);
          continue;
        }
        leaseToken = lease.leaseToken;
      }
      catch (err) {
        failNotes.push(`${label}:执行权申请失败 ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
    }
    let result;
    try {
      result = await accountStore.betting(account, checked, 0, { requirePreparedQuote: true });
    }
    catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (leaseToken) {
        await finalizePodBetExecution({ leaseToken, state: "unknown", message }).catch(() => {});
      }
      failNotes.push(`${label}:结果未知 ${message}`);
      continue;
    }
    if (!result.success) {
      const tip = result.tip && typeof result.tip === "object"
        ? result.tip as Record<string, unknown>
        : null;
      // 有官方响应（response / pmPosted）才是明确拒绝；无响应可能发生在 POST 后断线。
      const outcomeUnknown = result.response == null && tip?.pmPosted !== true;
      if (leaseToken) {
        await finalizePodBetExecution({
          leaseToken,
          state: outcomeUnknown ? "unknown" : "failed",
          message: result.message || "下单失败",
        }).catch(() => {});
      }
      failNotes.push(`${label}:${outcomeUnknown ? "结果未知 " : ""}${result.message || "下单失败"}`);
      continue;
    }
    const orderId = String(result.orderId || "").trim();
    if (leaseToken) {
      await finalizePodBetExecution({
        leaseToken,
        state: "accepted",
        venueOrderId: orderId,
        message: result.pending ? "场馆已受理，等待成交" : "场馆已受理",
      }).catch(() => {});
    }
    await orders.appendVenuePlaced({
      id: accountId ? `${ticket.id}#PM#${accountId}` : `${ticket.id}#PM`,
      orderId,
      at: Date.now(),
      home: String(ticket.home || "").trim(),
      away: String(ticket.away || "").trim(),
      sideLabel: String(ticket.sideLabel || "").trim(),
      marketLabel: String(ticket.marketLabel || "").trim(),
      odds,
      stake: planStakeCny,
      oid: tokenId,
      obMid: conditionId,
      pmMatchId: matchId,
      auto: ticket.auto === true,
      status: result.pending ? "Pending" : "None",
      profit: 0,
      venue: PM,
      playerId: accountId,
      accountName: label,
    }, account, { venue: PM, hydrateOb: false, source: ticket.auto === true ? "football-pod-auto" : "football-pod" });
    okNotes.push(orderId ? `${label}:${orderId}` : label);
  }

  if (!okNotes.length)
    return { ok: false, message: failNotes.join("；") || "PM 下单失败" };
  const head = accounts.length > 1 ? `${okNotes.length}/${accounts.length} ` : "";
  const body = okNotes.join("、");
  const msg = failNotes.length
    ? `${head}${body}；失败 ${failNotes.join("；")}`
    : `${head}${body}`;
  return { ok: true, message: msg.slice(0, 180) };
}
