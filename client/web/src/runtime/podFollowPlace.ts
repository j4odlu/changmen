/**
 * POD 跟单下单门控。猜测身份；自动默认关。不进电竞 mainBetLoop。
 * AutoYabo 自动挑选在 podYabo/auto。
 */
import type { PodObQuoteCompare, PodMarketMatch } from "@/runtime/podMarketMatch";
import type { PodFixtureMatchBasis } from "@/runtime/podFixtureMatch";
import { pickObSportBetAccounts } from "@/runtime/obSportBetAccount";
import { placeObSportSingle } from "@/runtime/obSportPlaceBet";
import { readPodBetSettings } from "@/runtime/podBetSettings";
import { pickPodObAccountsForPlacement } from "@/runtime/podObAccountRotation";
import { useAccountStore } from "@/stores/accountStore";
import { useFootballOrderStore } from "@/stores/footballOrderStore";
import { finalizePodBetExecution, reservePodBetExecution } from "@/api/podBetExecution";
import { podOutcomeExecutionScope, podOutcomeGateEntryFrom } from "@/runtime/podYabo/gate";

export type PodFollowPlaceTicket = {
  id: string;
  stake: number;
  fixtureStatus: string;
  fixtureBasis?: PodFixtureMatchBasis;
  obMid: string;
  home?: string;
  away?: string;
  sideLabel?: string;
  marketLabel?: string;
  auto?: boolean;
  submitBefore?: number;
  accountIds?: number[];
  market: Pick<PodMarketMatch, "status" | "ob" | "locked" | "oid" | "quote" | "marketCode" | "boardSide" | "boardLine" | "fromLive">;
  quote: PodObQuoteCompare;
};

export function podFollowPlaceBlock(ticket: PodFollowPlaceTicket): string | null {
  if (ticket.fixtureStatus !== "matched")
    return "场未对上";
  if (ticket.market.status !== "matched")
    return "盘未对上";
  if (!ticket.market.ob)
    return "无 OB 盘";
  if (!String(ticket.market.oid || "").trim())
    return "无 oid";
  if (ticket.market.locked)
    return "锁盘";
  if (ticket.quote.status !== "ok") {
    if (ticket.quote.status === "spike")
      return "EV 异常";
    return "OB 价不够";
  }
  if (!(Number(ticket.stake) > 0))
    return "OB金额未设";
  if (!Array.isArray(ticket.accountIds) || !ticket.accountIds.some(id => Number(id) > 0))
    return "请选择 OB 账号";
  if (!String(ticket.obMid || "").trim())
    return "无 OB mid";
  return null;
}

export async function placePodFollowBet(ticket: PodFollowPlaceTicket): Promise<{ ok: boolean; message: string; outcomeUnknown?: boolean }> {
  const block = podFollowPlaceBlock(ticket);
  if (block)
    return { ok: false, message: block };
  const settings = readPodBetSettings();
  const selectedIds = Array.isArray(ticket.accountIds) ? ticket.accountIds : settings.followAccountIds;
  const eligibleAccounts = selectedIds.length
    ? pickObSportBetAccounts(useAccountStore().accounts, selectedIds)
    : [];
  if (!eligibleAccounts.length)
    return { ok: false, message: "请选择 OB 账号（需体育 token）" };
  const accounts = pickPodObAccountsForPlacement(eligibleAccounts, settings.obAccountRotation);

  const orders = useFootballOrderStore();
  const okNotes: string[] = [];
  const failNotes: string[] = [];
  let outcomeUnknown = false;
  const stake = Number(ticket.stake);
  const odds = Number(ticket.quote.quote) || Number(ticket.market.quote) || 0;
  const oid = String(ticket.market.oid || "").trim();
  const mid = String(ticket.obMid || "").trim();
  const line = ticket.market.boardLine;
  // fromLive 只表示板上实时仓有价，不等于滚球；matchType 以预检回包为准，这里只给查询初值
  const matchType = 1;

  for (const account of accounts) {
    const accountId = Number(account.accountId) || 0;
    const label = String(account.playerName || accountId || "账号").trim() || "账号";
    let leaseToken = "";
    if (ticket.auto === true) {
      try {
        const lease = await reservePodBetExecution({ alertId: ticket.id, venue: "OB", playerId: accountId,
          outcomeScope: podOutcomeExecutionScope(podOutcomeGateEntryFrom(ticket)) });
        if (!lease.acquired) {
          outcomeUnknown ||= lease.state === "reserved" || lease.state === "unknown";
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
    let placed;
    try {
      placed = await placeObSportSingle({
        oid,
        mid,
        odds,
        stake,
        minOdds: Number(ticket.quote.minObOdds) || 0,
        maxOdds: Number(ticket.quote.maxObOdds) || 0,
        submitBefore: ticket.auto ? ticket.submitBefore : undefined,
        marketCode: String(ticket.market.marketCode || "").trim(),
        boardSide: String(ticket.market.boardSide || "").trim(),
        line,
        matchType,
        accountId,
      });
    }
    catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outcomeUnknown = true;
      if (leaseToken) {
        await finalizePodBetExecution({ leaseToken, state: "unknown", message }).catch(() => {});
      }
      failNotes.push(`${label}:结果未知 ${message}`);
      continue;
    }
    if (!placed.ok) {
      outcomeUnknown ||= placed.outcomeUnknown === true;
      if (leaseToken) {
        await finalizePodBetExecution({
          leaseToken,
          state: placed.outcomeUnknown ? "unknown" : "failed",
          message: placed.message,
        }).catch(() => {});
      }
      failNotes.push(`${label}:${placed.outcomeUnknown ? "结果未知 " : ""}${placed.message}`);
      continue;
    }
    const orderId = String(placed.orderId || "").trim();
    if (leaseToken) {
      await finalizePodBetExecution({
        leaseToken,
        state: "accepted",
        venueOrderId: orderId,
        message: "场馆已受理",
      }).catch(() => {});
    }
    await orders.appendPlaced({
      id: accountId ? `${ticket.id}#${accountId}` : ticket.id,
      orderId,
      at: Date.now(),
      home: String(ticket.home || "").trim(),
      away: String(ticket.away || "").trim(),
      sideLabel: String(ticket.sideLabel || "").trim(),
      marketLabel: String(ticket.marketLabel || "").trim(),
      odds: Number(placed.odds) > 1 ? Number(placed.odds) : odds,
      stake,
      oid,
      obMid: mid,
      auto: ticket.auto === true,
      status: "None",
      profit: 0,
      playerId: accountId,
      accountName: label,
    }, account);
    okNotes.push(orderId ? `${label}:${orderId}` : label);
  }

  if (!okNotes.length)
    return { ok: false, message: failNotes.join("；") || "下单失败", outcomeUnknown };
  // 面板标签已是「已下」，这里只留 账号:订单号（多号带成功数）
  const head = accounts.length > 1 ? `${okNotes.length}/${accounts.length} ` : "";
  const body = okNotes.join("、");
  const msg = failNotes.length
    ? `${head}${body}；失败 ${failNotes.join("；")}`
    : `${head}${body}`;
  return { ok: true, message: msg.slice(0, 180), outcomeUnknown };
}
