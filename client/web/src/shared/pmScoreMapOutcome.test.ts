import { describe, expect, it } from "vitest";
import { computed, reactive } from "vue";
import type { PmSportSnapshot } from "@/types/esport";
import { readPmScoreMapOutcome, type PmScoreMapOutcome } from "./pmScoreMapOutcome";
import fixture from "./fixtures/pm-procyon-map-one.json";

const input = (snapshot: PmSportSnapshot, extra = {}) => ({ snapshot, eventKey: "event", map: 1,
  homeName: "Home", awayName: "Away", homeTokenId: "h", awayTokenId: "a", ...extra });
const snapshot = (extra: Partial<PmSportSnapshot> = {}): PmSportSnapshot => ({
  live: true, currentMap: 2, period: "2/3", bo: 3, homeTeam: "Home", awayTeam: "Away",
  scoreRaw: "000-000|1-0|Bo3", mapScore: { home: 1, away: 0 }, ...extra,
});

describe("display-only PM map outcomes from score evidence", () => {
  it("uses exact native names and both tokens, rejecting mismatched event, map, teams or token evidence", () => {
    const source = fixture.match.Bets[0]!.Sources.Polymarket;
    const context = input(fixture.match.PmSport, { eventKey: '1205551', homeName: 'Procyon Team', awayName: 'your end',
      homeTokenId: source.HomeID, awayTokenId: source.AwayID, market: fixture.entry });
    expect(readPmScoreMapOutcome(context)?.side).toBe('home');
    for (const market of [
      { ...fixture.entry, sourceMatchId: 'other' }, { ...fixture.entry, map: 2 },
      { ...fixture.entry, homeTokenId: 'other' }, { ...fixture.entry, awayTokenId: 'other' },
      { ...fixture.entry, homeName: 'Procyon Academy' }, { ...fixture.entry, homeName: '' },
    ]) expect(readPmScoreMapOutcome({ ...context, market })).toBeNull();
    expect(readPmScoreMapOutcome({ ...context, eventKey: 'other' })).toBeNull();
    expect(readPmScoreMapOutcome({ ...context, snapshot: { ...context.snapshot, slug: 'other' } })).toBeNull();
    expect(readPmScoreMapOutcome({ ...context, eventKey: fixture.entry.eventSlug })?.side).toBe('home');
    expect(readPmScoreMapOutcome({ ...context, market: { ...fixture.entry, eventSlug: undefined } })?.side).toBe('home');
  });
  it("retains the observed result across reactive score updates, but clears it on a match switch", () => {
    const context = reactive(input(snapshot()));
    const result = computed<PmScoreMapOutcome | null>(previous => readPmScoreMapOutcome(context, previous));
    expect(result.value?.side).toBe("home");
    context.snapshot = snapshot({ currentMap: 3, period: "3/3", scoreRaw: "000-000|1-1|Bo3", mapScore: { home: 1, away: 1 } });
    expect(result.value?.side).toBe("home");
    context.eventKey = "another";
    expect(result.value).toBeNull();
  });

  it("preserves an observed map winner while the aggregate score advances before the period field", () => {
    const initial = readPmScoreMapOutcome(input(snapshot()));
    const transitional = input(snapshot({ scoreRaw: "000-000|1-1|Bo3", mapScore: { home: 1, away: 1 } }));
    expect(readPmScoreMapOutcome(transitional)).toBeNull();
    const retained = readPmScoreMapOutcome(transitional, initial);
    expect(retained?.side).toBe("home");
    transitional.snapshot.currentMap = 3;
    transitional.snapshot.period = "3/3";
    expect(readPmScoreMapOutcome(transitional, retained)?.side).toBe("home");
  });
  it("identifies map one from 1–0 and 0–1 while leaving the current map and full match alone", () => {
    expect(readPmScoreMapOutcome(input(snapshot()))?.side).toBe("home");
    const away = snapshot({ scoreRaw: "000-000|0-1|Bo3", mapScore: { home: 0, away: 1 } });
    expect(readPmScoreMapOutcome(input(away))?.side).toBe("away");
    for (const map of [0, 2, 3, -1, 1.5]) expect(readPmScoreMapOutcome(input(snapshot(), { map }))).toBeNull();
  });

  it("uses the supplied team names for both raw reversed HTTP and already-aligned push scores without a second swap", () => {
    const raw = snapshot({ homeTeam: "Away", awayTeam: "Home" });
    expect(readPmScoreMapOutcome(input(raw))?.side).toBe("away");
    const aligned = snapshot({ mapScore: { home: 0, away: 1 } });
    expect(readPmScoreMapOutcome(input(aligned))?.side).toBe("away");
    expect(readPmScoreMapOutcome(input(snapshot({ homeTeam: " HOME ", awayTeam: "away" })))?.side).toBe("home");
    for (const extra of [{ homeTeam: "Unknown" }, { awayTeam: "" }, { homeTeam: "Away", awayTeam: "Away" }])
      expect(readPmScoreMapOutcome(input(snapshot(extra)))).toBeNull();
  });

  it("does not invent map order from a mixed aggregate score, but retains a previously observed map result", () => {
    const initial = readPmScoreMapOutcome(input(snapshot()));
    const later = input(snapshot({ currentMap: 3, period: "3/3", scoreRaw: "000-000|1-1|Bo3", mapScore: { home: 1, away: 1 } }));
    expect(readPmScoreMapOutcome(later)).toBeNull();
    expect(readPmScoreMapOutcome(later, initial)?.side).toBe("home");
    expect(readPmScoreMapOutcome({ ...later, map: 2 }, initial)).toBeNull();
    expect(readPmScoreMapOutcome({ ...later, eventKey: "another" }, initial)).toBeNull();
    expect(readPmScoreMapOutcome({ ...later, homeTokenId: "another" }, initial)).toBeNull();
  });

  it("withdraws or corrects earlier evidence after a score correction, and never marks unplayed maps", () => {
    const initial = readPmScoreMapOutcome(input(snapshot()));
    const corrected = snapshot({ scoreRaw: "000-000|0-1|Bo3", mapScore: { home: 0, away: 1 } });
    expect(readPmScoreMapOutcome(input(corrected), initial)?.side).toBe("away");
    expect(readPmScoreMapOutcome(input(snapshot({ currentMap: 1, period: "1/3", scoreRaw: "000-000|0-0|Bo3", mapScore: { home: 0, away: 0 } })), initial)).toBeNull();
    const ended = snapshot({ live: false, ended: true, scoreRaw: "000-000|2-0|Bo3", mapScore: { home: 2, away: 0 } });
    expect(readPmScoreMapOutcome(input(ended, { map: 2 }))?.side).toBe("home");
    expect(readPmScoreMapOutcome(input(ended, { map: 3 }))).toBeNull();
    const mixed = snapshot({ live: false, ended: true, scoreRaw: "000-000|2-1|Bo3", mapScore: { home: 2, away: 1 } });
    expect(readPmScoreMapOutcome(input(mixed))).toBeNull();
  });

  it.each([
    { scoreRaw: undefined }, { scoreRaw: "1-0" }, { scoreRaw: "000-000|invalid|Bo3" },
    { scoreRaw: "000-000|0-0|Bo3" }, { mapScore: { home: -1, away: 2 } },
    { mapScore: { home: 0.5, away: 0.5 } }, { mapScore: undefined },
    { currentMap: 3 }, { bo: 0 }, { bo: 1 }, { bo: 0.5 }, { bo: 0.9 },
    { status: "canceled" }, { status: "postponed" }, { live: false },
  ])("rejects missing, inconsistent or inactive evidence: %j", extra => {
    expect(readPmScoreMapOutcome(input(snapshot(extra)))).toBeNull();
  });
});
