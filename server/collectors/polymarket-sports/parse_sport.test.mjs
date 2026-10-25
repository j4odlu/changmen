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

test("plain basketball scores retain both sides without inventing a BO", () => {
  for (const [raw, home, away] of [["98-94", 98, 94], [" 110 - 108 ", 110, 108], ["0-12", 0, 12], ["0-0", 0, 0]]) {
    const parsed = parseEsportsScore(raw);
    assert.deepEqual(parsed.mapScore, { home, away });
    assert.equal(parsed.bo, null);
  }
});

test("missing or malformed plain scores keep the existing empty-score behavior", () => {
  for (const raw of [undefined, "", "NS", "98-", "98-unknown", "-1-94", "98-94 extra"])
    assert.deepEqual(parseEsportsScore(raw), { mapScore: { home: 0, away: 0 }, bo: null });
});

test("basketball snapshot and reversed display use actual points", () => {
  const snapshot = buildPmSportSnapshot({
    gameId: 5127839, leagueAbbreviation: "NBA", status: "InProgress",
    live: true, ended: false, score: "98-94", period: "Q4", elapsed: "05:12",
    homeTeam: "Home", awayTeam: "Away",
  });
  assert.deepEqual(snapshot.mapScore, { home: 98, away: 94 });
  assert.equal(snapshot.scoreRaw, "98-94");
  assert.equal(snapshot.bo, undefined);
  assert.equal(snapshot.currentMap, null);
  assert.equal(snapshot.label, "进行中 · Q4 · 98-94 · 已进行05:12");
  const reversed = alignPmSportSnapshot(snapshot, true);
  assert.deepEqual(reversed.mapScore, { home: 94, away: 98 });
  assert.equal(reversed.homeTeam, "Away");
  assert.equal(reversed.awayTeam, "Home");
  assert.equal(reversed.label, "进行中 · Q4 · 94-98 · 已进行05:12");
  assert.deepEqual(snapshot.mapScore, { home: 98, away: 94 });
});

test("esports series scores still come from the second segment, not in-map points", () => {
  assert.deepEqual(parseEsportsScore("13-8|2-1|Bo5"), { mapScore: { home: 2, away: 1 }, bo: 5 });
  assert.deepEqual(parseEsportsScore("13-8||Bo3"), { mapScore: { home: 0, away: 0 }, bo: 3 });
});

test("parsePeriodToCurrentMap", () => {
  assert.equal(parsePeriodToCurrentMap("2/3"), 2);
  assert.equal(parsePeriodToCurrentMap(undefined), null);
});

test("basketball quarters and halves are not esports map numbers", () => {
  for (const period of ["1Q", "2Q", "3Q", "4Q", "Q4", "1H", "2H", "HT", "OT", "FT", "NS"]) {
    assert.equal(parsePeriodToCurrentMap(period), null, period);
    assert.equal(buildPmSportSnapshot({ status: "InProgress", period }).currentMap, null, period);
  }
  for (const [period, map] of [["1/1", 1], ["2/3", 2], ["3/5", 3], ["2", 2], [" 2/3 ", 2]])
    assert.equal(parsePeriodToCurrentMap(period), map);
});

test("buildPmSportLabel finished", () => {
  assert.equal(
    buildPmSportLabel({ status: "finished", ended: true, mapScore: { home: 2, away: 0 } }),
    "已结束 · 2-0",
  );
});

test("official basketball final statuses are terminal without score or period inference", () => {
  for (const status of ["Final", "final", "F/OT"]) {
    const snapshot = buildPmSportSnapshot({ status, live: false, ended: false, score: "110-108" });
    assert.equal(snapshot.status, status);
    assert.equal(snapshot.ended, true);
    assert.deepEqual(snapshot.mapScore, { home: 110, away: 108 });
    assert.equal(snapshot.label, "已结束 · 110-108");
    assert.equal(buildPmSportLabel({ status, mapScore: snapshot.mapScore }), "已结束 · 110-108");
  }
  for (const message of [{ score: "110-108" }, { period: "FT" }, { period: "FT OT" }])
    assert.equal(buildPmSportSnapshot(message).ended, false);
});

test("official basketball exceptional statuses remain distinct from a final game", () => {
  for (const [status, label] of [["Suspended", "暂停"], ["Delayed", "延迟"], ["Forfeit", "弃权"], ["NotNecessary", "无需进行"]]) {
    const snapshot = buildPmSportSnapshot({ status, live: false, ended: false });
    assert.equal(snapshot.status, status);
    assert.equal(snapshot.label, label);
    assert.equal(snapshot.ended, false);
  }
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
