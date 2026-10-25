import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ snapshot: vi.fn() }));
vi.mock("./io/snapshot.js", () => ({ loadSnapshot: mocks.snapshot, normalizeMatchesShape: value => value }));
import { composeOnce } from "./compose_once.js";

it("dry-run reports a PM-confirmed end even when the match is absent from current clustering", async () => {
  const now = Date.now();
  const cm = { id: 42, start_time: now - 3600000, matchs: { OB: "gone", Polymarket: "pm1" },
    pm_sport: { ended: true, eventId: "pm1" } };
  mocks.snapshot.mockResolvedValue({
    matches: { Polymarket: { pm1: { SourceMatchID: "pm1", SourceGameID: "3", Home: "Alpha", Away: "Beta", StartTime: cm.start_time } } },
    bets: {}, timers: {}, clientRows: [cm], alignClientRows: [cm],
  });
  const result = await composeOnce({ write: false, registerTeams: false });
  expect(result.wrote).toBe(false);
  expect(result.info).toEqual([]);
  expect(result.endedCount).toBe(1);
  expect(result.markEndedIds).toEqual([42]);
  expect(result.activeGaps).toEqual([]);
  expect(cm.matchs).toEqual({ OB: "gone", Polymarket: "pm1" });
});
