import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PodDropAlert } from "@/runtime/podAlerts";
import { POD_BET_SETTINGS_DEFAULTS } from "@/runtime/podBetSettings";
import { buildPodBetTicket } from "@/runtime/podBetTicket";
import {
  buildPodFollowLogRow,
  formatPodFollowLogEv,
  formatPodFollowLogPlace,
  formatPodFollowLogQuote,
  parsePodFollowLog,
  ticketHasPodFollowEv,
  ticketHasPodFollowMatch,
  upsertPodFollowEv,
  markPodFollowLogPlaced,
  markPodFollowVenueSubmitted,
  readPodFollowLog,
} from "@/runtime/podFollowLog";

function alert(over: Partial<PodDropAlert> = {}): PodDropAlert {
  return {
    id: "1",
    eventId: "e",
    sport: "Football",
    sportId: 1,
    league: "EPL",
    home: "Arsenal",
    away: "Chelsea",
    starts: 2_000_000,
    alertedAt: 1_950_000,
    market: "Totals",
    lineType: "total",
    period: 0,
    outcome: "over",
    points: 2.5,
    previous: 2.1,
    current: 1.9,
    nvp: 1.85,
    dropPct: 10,
    ways: null,
    ...over,
  };
}

function liveTicket(over: Record<string, unknown> = {}) {
  const ticket = buildPodBetTicket(alert(), { ...POD_BET_SETTINGS_DEFAULTS, enabled: true, stake: 50 }, 1_960_000)!;
  return {
    ...ticket,
    fixtureMatch: { status: "matched" as const, hits: [{ fixture: { obMid: "5652292" } }] },
    marketMatch: {
      status: "matched" as const,
      oid: "oid-over",
      marketCode: "totals",
      boardLine: 2.5,
      boardSide: "over" as const,
      nvp: 0,
    },
    obQuote: { status: "ok" as const, quote: 1.95, minObOdds: 1.924, maxObOdds: 2.183, evPercent: 5.4 },
    ...over,
  };
}

const mem = new Map<string, string>();

beforeEach(() => {
  mem.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => mem.get(key) ?? null,
    setItem: (key: string, value: string) => { mem.set(key, String(value)); },
    removeItem: (key: string) => { mem.delete(key); },
  });
});

describe("podFollowLog", () => {
  it("persists a PM-only opportunity and freezes its submission without marking OB placed", () => {
    const ticket = liveTicket();
    const pm = { ...ticket, fixtureMatch: { status: "matched" as const,
      hits: [{ fixture: { id: 88, obMid: "", providers: { Polymarket: "pm-88" } } }] },
      marketMatch: { ...ticket.marketMatch, venue: "Polymarket" } };
    const row = buildPodFollowLogRow(pm, 1_970_000);
    expect(upsertPodFollowEv(row).added).toBe(true);
    markPodFollowVenueSubmitted(row.id, row.venues!.Polymarket, "PM已下 1/1 alice:order-1", 1_980_000, { ...row, pinCurrent: 1.88 });
    const changed = buildPodFollowLogRow({ ...pm, pinCurrent: 1.2,
      obQuote: { ...pm.obQuote, quote: 4 } }, 1_990_000);
    upsertPodFollowEv(changed);
    const saved = readPodFollowLog()[0];
    expect(saved.placed).toBe(false);
    expect(saved.pinCurrent).toBe(1.88);
    expect(saved.venues?.Polymarket).toMatchObject({ quote: 1.95, matchId: "pm-88", fixtureId: 88,
      submittedAt: 1_980_000, note: "PM已下 1/1 alice:order-1" });
  });

  it("updates another venue's reference quote without overwriting a submitted venue", () => {
    const row = buildPodFollowLogRow(liveTicket(), 1_970_000);
    upsertPodFollowEv(row);
    markPodFollowVenueSubmitted(row.id, row.venues!.OB, "已下 1/1 bob:o1", 1_980_000);
    const changed = { ...row, venues: { OB: { ...row.venues!.OB, quote: 4 },
      RAY: { ...row.venues!.OB, venue: "RAY", matchId: "ray-1", quote: 2.2 } } };
    upsertPodFollowEv(changed);
    const saved = readPodFollowLog()[0];
    expect(saved.venues?.OB.quote).toBe(1.95);
    expect(saved.venues?.RAY.quote).toBe(2.2);
  });

  it("only treats matched fixtures and markets as follow tickets", () => {
    expect(ticketHasPodFollowMatch(liveTicket())).toBe(true);
    expect(ticketHasPodFollowEv(liveTicket())).toBe(true);
    expect(ticketHasPodFollowMatch(liveTicket({
      obQuote: { status: "short", quote: 1.8, minObOdds: 1.924, maxObOdds: 2.183, evPercent: -2.7 },
    }))).toBe(true);
    expect(ticketHasPodFollowEv(liveTicket({
      obQuote: { status: "short", quote: 1.8, minObOdds: 1.924, maxObOdds: 2.183, evPercent: -2.7 },
    }))).toBe(false);
    expect(ticketHasPodFollowMatch(liveTicket({
      fixtureMatch: { status: "none", hits: [] },
    }))).toBe(false);
  });

  it("records a follow ticket and updates the quote until placed", () => {
    const row = buildPodFollowLogRow(liveTicket(), 1_970_000);
    expect(row.home).toBe("Arsenal");
    expect(row.obMid).toBe("5652292");
    expect(row.obQuote).toBe(1.95);
    expect(row.pinPrevious).toBe(2.1);
    expect(row.pinCurrent).toBe(1.9);
    expect(row.placed).toBe(false);
    expect(formatPodFollowLogPlace(row)).toBe("未下");
    expect(formatPodFollowLogQuote(row)).toBe("OB 1.95 够");
    expect(formatPodFollowLogEv(row)).toBe("EV +5.4%");
    const first = upsertPodFollowEv(row);
    expect(first.added).toBe(true);
    expect(first.rows).toHaveLength(1);
    const unmatched = buildPodFollowLogRow(liveTicket({
      fixtureMatch: { status: "none", hits: [] },
      marketMatch: { status: "none" as const, oid: "", marketCode: "", boardLine: null, boardSide: null, nvp: 0 },
      obQuote: { status: "none" as const, quote: 0, minObOdds: 1.924, maxObOdds: 2.183, evPercent: 0 },
    }), 1_971_000);
    unmatched.id = "2";
    const saved = upsertPodFollowEv(unmatched);
    expect(saved.added).toBe(false);
    expect(saved.rows).toHaveLength(1);
    const again = upsertPodFollowEv({ ...row, obQuote: 2.2, at: 1_980_000 });
    expect(again.added).toBe(false);
    expect(again.wrote).toBe(true);
    expect(again.rows.find(item => item.id === "1")?.obQuote).toBe(2.2);
    expect(again.rows.find(item => item.id === "1")?.at).toBe(1_970_000);
    const placed = markPodFollowLogPlaced("1", "已下 88", 1_985_000, {
      obQuote: 2.05,
      nvp: 1.85,
      minObOdds: 1.924,
      pinPrevious: 2.1,
      pinCurrent: 1.9,
    });
    const hit = placed.find(item => item.id === "1")!;
    expect(hit.placed).toBe(true);
    expect(hit.obQuote).toBe(2.05);
    expect(formatPodFollowLogPlace(hit)).toMatch(/^已下/);
    const frozen = upsertPodFollowEv({ ...row, obQuote: 3, at: 1_990_000 });
    expect(frozen.wrote).toBe(false);
    expect(frozen.rows.find(item => item.id === "1")?.obQuote).toBe(2.05);
    expect(parsePodFollowLog([{ id: "1" }, { id: "1", home: "dup" }])).toHaveLength(1);
  });
});
