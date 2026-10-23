import type { PodFollowExecutionTicket, PodFollowCell } from "./podFollowExecutionTypes";
import type { PodFollowPayload } from "./podFollowPayload";
import type { PodFollowOrderGate } from "./podFollowOrderGate";
import type { PodFollowLogRow } from "./podFollowLog";
import type { PodOutcomeGateEntry } from "./podYabo/gate";
import { placePodFollowBet, podFollowPlaceBlock } from "./podFollowPlace";
import { placePodPmFollowBet, podPmFollowPlaceBlock } from "./podPmFollowPlace";
import { placePodRayFollowBet } from "./podRayFollowPlace";
import { buildPodFollowLogRow, buildPodFollowVenueLog, buildPodFollowPlaceSnap, markPodFollowLogPlaced, markPodFollowVenueSubmitted } from "./podFollowLog";
import { recordFootballFollowAttempt } from "./footballFollowAttempt";

export interface PodFollowPlacementContext {
  placingId: PodFollowCell<string>;
  placingPmId: PodFollowCell<string>;
  placingRayId: PodFollowCell<string>;
  placed: PodFollowCell<Record<string, true>>;
  autoAttempted: PodFollowCell<Record<string, true>>;
  obExecutionEntries: PodFollowCell<Record<string, PodOutcomeGateEntry>>;
  placeNote: PodFollowCell<Record<string, string>>;
  logRows: PodFollowCell<PodFollowLogRow[]>;
  payloads: Pick<PodFollowPayload, "ticketPlacePayload" | "pmTicketPlacePayload" | "rayTicketPlacePayload" | "followStakeFor">;
  gates: Pick<PodFollowOrderGate, "placeBlock" | "isVenuePlaced" | "venueDailyOrderBlock" | "venuePlaceKey" | "rayPlaceBlock">;
  refreshRayOrders: () => Promise<void>;
  messages: { warning: (text: string) => unknown; info: (text: string) => unknown; success: (text: string) => unknown; error: (text: string) => unknown };
}

export function createPodFollowPlacement(ctx: PodFollowPlacementContext) {
  const { placingId, placingPmId, placingRayId, placed, autoAttempted, obExecutionEntries, placeNote, logRows, refreshRayOrders, messages: ElMessage } = ctx;
  const { ticketPlacePayload, pmTicketPlacePayload, rayTicketPlacePayload, followStakeFor } = ctx.payloads;
  const { placeBlock, isVenuePlaced, venueDailyOrderBlock, venuePlaceKey, rayPlaceBlock } = ctx.gates;

  async function placeTicket(ticket: PodFollowExecutionTicket, auto: boolean) {
    if (placingId.value)
      return;
    const payload = ticketPlacePayload(ticket, auto);
    const displaySnapshot = buildPodFollowVenueLog(ticket);
    const displayReference = buildPodFollowLogRow(ticket);
    recordObAttempt(ticket, auto ? "auto_attempt" : "manual_click", { stake: payload.stake });
    const block = placeBlock(ticket) || podFollowPlaceBlock(payload);
    if (block) {
      recordObAttempt(ticket, "blocked", { reason: block });
      if (!auto)
        ElMessage.warning(block);
      return;
    }
    if (isVenuePlaced(ticket.id, "OB")) {
      recordObAttempt(ticket, "blocked", { reason: "已下过" });
      if (!auto)
        ElMessage.info("已下过");
      return;
    }
    placingId.value = ticket.id;
    obExecutionEntries.value = { ...obExecutionEntries.value, [ticket.id]: {
      obMid: payload.obMid, marketCode: payload.market.marketCode, boardSide: payload.market.boardSide,
    } };
    try {
      const result = await placePodFollowBet(payload);
      if (!result.ok && !result.outcomeUnknown) {
        const next = { ...obExecutionEntries.value };
        delete next[ticket.id];
        obExecutionEntries.value = next;
      }
      if (result.outcomeUnknown)
        autoAttempted.value = { ...autoAttempted.value, [venuePlaceKey("OB", ticket.id)]: true };
      const key = venuePlaceKey("OB", ticket.id);
      placeNote.value = { ...placeNote.value, [key]: result.message };
      if (result.ok) {
        recordObAttempt(ticket, "placed", { message: result.message });
        placed.value = { ...placed.value, [key]: true };
        logRows.value = markPodFollowLogPlaced(
          ticket.id,
          result.message,
          Date.now(),
          buildPodFollowPlaceSnap(ticket),
        );
        logRows.value = markPodFollowVenueSubmitted(ticket.id, displaySnapshot, result.message, Date.now(), displayReference);
        ElMessage.success(result.message);
        return;
      }
      recordObAttempt(ticket, "failed", { message: result.message });
      if (auto)
        ElMessage.warning(result.message);
      else
        ElMessage.error(result.message);
    }
    finally {
      placingId.value = "";
    }
  }

  async function placePmTicket(ticket: PodFollowExecutionTicket, auto = false) {
    if (placingPmId.value)
      return;
    const payload = pmTicketPlacePayload(ticket, auto);
    const displaySnapshot = buildPodFollowVenueLog({ ...ticket, fixtureMatch: ticket.pmFixtureMatch, marketMatch: ticket.pmMarketMatch, obQuote: ticket.pmQuote });
    const displayReference = buildPodFollowLogRow(ticket);
    const block = venueDailyOrderBlock("Polymarket") || podPmFollowPlaceBlock(payload);
    if (block) {
      if (!auto)
        ElMessage.warning(block);
      return;
    }
    if (isVenuePlaced(ticket.id, "Polymarket")) {
      if (!auto)
        ElMessage.info("已下过");
      return;
    }
    placingPmId.value = ticket.id;
    try {
      const result = await placePodPmFollowBet(payload);
      const key = venuePlaceKey("Polymarket", ticket.id);
      placeNote.value = { ...placeNote.value, [key]: result.message };
      if (result.ok) {
        placed.value = { ...placed.value, [key]: true };
        logRows.value = markPodFollowVenueSubmitted(ticket.id, displaySnapshot, result.message, Date.now(), displayReference);
        ElMessage.success(result.message);
        return;
      }
      if (auto)
        ElMessage.warning(result.message);
      else
        ElMessage.error(result.message);
    }
    finally {
      placingPmId.value = "";
    }
  }

  async function placeRayTicket(ticket: PodFollowExecutionTicket, auto = false) {
    if (placingRayId.value) return;
    const block = rayPlaceBlock(ticket);
    if (block) { if (!auto) ElMessage.warning(block); return; }
    placingRayId.value = ticket.id;
    const displaySnapshot = buildPodFollowVenueLog({ ...ticket, fixtureMatch: ticket.rayFixtureMatch, marketMatch: ticket.rayMarketMatch, obQuote: ticket.rayQuote });
    const displayReference = buildPodFollowLogRow(ticket);
    try {
      const result = await placePodRayFollowBet(rayTicketPlacePayload(ticket, auto));
      const key = venuePlaceKey("RAY", ticket.id);
      placeNote.value = { ...placeNote.value, [key]: result.message };
      if (result.ok) { placed.value = { ...placed.value, [key]: true }; logRows.value = markPodFollowVenueSubmitted(ticket.id, displaySnapshot, result.message, Date.now(), displayReference); ElMessage.success(result.message); }
      else ElMessage.warning(result.message);
      await refreshRayOrders();
    }
    finally { placingRayId.value = ""; }
  }

  function recordObAttempt(
    ticket: PodFollowExecutionTicket,
    status: "manual_click" | "auto_attempt" | "blocked" | "placed" | "failed",
    opts: { reason?: string; message?: string; stake?: number } = {},
  ) {
    const shadowMessage = ticket.shadowCompare.ok ? "" : `shadow:${ticket.shadowCompare.summary}`;
    const message = [opts.message, shadowMessage].filter(Boolean).join(" | ");
    recordFootballFollowAttempt({
      ticketId: ticket.id,
      venue: "OB",
      status,
      reason: opts.reason,
      message,
      auto: status === "auto_attempt",
      odds: Number(ticket.obQuote.quote) || Number(ticket.marketMatch.quote) || 0,
      stake: Number(opts.stake) || followStakeFor("OB"),
      selection: ticket.selectionShadow.key,
    });
  }

  return { placeTicket, placePmTicket, placeRayTicket, recordObAttempt };
}

export type PodFollowPlacement = ReturnType<typeof createPodFollowPlacement>;
