import assert from "node:assert/strict";
import test from "node:test";
import {
  alignPmSportSnapshot,
  buildPmSportDisplayLine,
  buildPmSportLabel,
  buildPmSportSnapshot,
  formatElapsed,
  formatResolutionSource,
  parseEsportsScore,
  parsePeriodToCurrentMap,
} from "./parse_sport.js";

test("parseEsportsScore splits map score and bo", () => {
  const row = parseEsportsScore("000-000|2-0|Bo3");
  assert.deepEqual(row.mapScore, { home: 2, away: 0 });
  assert.equal(row.bo, 3);
});

test("parsePeriodToCurrentMap", () => {
  assert.equal(parsePeriodToCurrentMap("2/3"), 2);
  assert.equal(parsePeriodToCurrentMap(undefined), null);
});

test("buildPmSportLabel finished", () => {
  assert.equal(
    buildPmSportLabel({ status: "finished", ended: true, mapScore: { home: 2, away: 0 } }),
    "已结束 · 2-0",
  );
});

test("buildPmSportDisplayLine uses PM fields only", () => {
  const line = buildPmSportDisplayLine({
    status: "running",
    live: true,
    ended: false,
    period: "2/3",
    mapScore: { home: 1, away: 0 },
    elapsed: "3720",
    resolutionSource: "https://vlr.gg",
  });
  assert.equal(line, "进行中 · 2/3 · 1-0 · 已进行62:00 · 来源 vlr.gg");
  assert.equal(line.includes("图内"), false);
  assert.equal(line.includes("图1"), false);
});

test("formatResolutionSource shortens URL", () => {
  assert.equal(
    formatResolutionSource("https://www.twitch.tv/valorant_tur"),
    "来源 twitch.tv/valorant_tur",
  );
});

test("buildPmSportSnapshot sets label from score and period", () => {
  const snap = buildPmSportSnapshot({
    gameId: 1,
    status: "running",
    live: true,
    ended: false,
    score: "000-000|1-0|Bo3",
    period: "2/3",
    elapsed: "120",
    resolutionSource: "https://vlr.gg",
    homeTeam: "A",
    awayTeam: "B",
  });
  assert.deepEqual(snap.mapScore, { home: 1, away: 0 });
  assert.equal(snap.period, "2/3");
  assert.equal(snap.maps, undefined);
  assert.match(snap.label, /进行中 · 2\/3 · 1-0/);
});

test("buildPmSportSnapshot preserves a numeric zero clock at map start", () => {
  const snapshot = buildPmSportSnapshot({ live: true, period: "2/3", elapsed: 0 });
  assert.equal(snapshot.elapsed, "0");
  assert.match(snapshot.label, /已进行0:00/);
});

test("buildPmSportSnapshot keeps eventId for archive identity", () => {
  const snap = buildPmSportSnapshot({
    gameId: 1,
    eventId: "evt-99",
    slug: "team-a-vs-team-b",
    status: "finished",
    ended: true,
    score: "000-000|2-0|Bo3",
  });
  assert.equal(snap.eventId, "evt-99");
  assert.equal(snap.slug, "team-a-vs-team-b");
  const fromPrev = buildPmSportSnapshot({
    gameId: 1,
    status: "finished",
    ended: true,
  }, { eventId: "evt-99", slug: "team-a-vs-team-b" });
  assert.equal(fromPrev.eventId, "evt-99");
  assert.equal(fromPrev.slug, "team-a-vs-team-b");
});

test("alignPmSportSnapshot flips map score when reversed", () => {
  const raw = buildPmSportSnapshot({
    gameId: 1,
    status: "running",
    live: true,
    ended: false,
    score: "000-000|2-1|Bo3",
    period: "3/3",
    homeTeam: "PM-Home",
    awayTeam: "PM-Away",
  });
  const aligned = alignPmSportSnapshot(raw, true);
  assert.deepEqual(aligned.mapScore, { home: 1, away: 2 });
  assert.equal(aligned.homeTeam, "PM-Away");
  assert.equal(aligned.awayTeam, "PM-Home");
});

test("alignPmSportSnapshot no-op when not reversed", () => {
  const raw = buildPmSportSnapshot({
    gameId: 1,
    status: "finished",
    ended: true,
    score: "000-000|2-0|Bo3",
    homeTeam: "A",
    awayTeam: "B",
  });
  assert.equal(alignPmSportSnapshot(raw, false), raw);
});

test("formatElapsed", () => {
  assert.equal(formatElapsed("3720"), "已进行62:00");
});
