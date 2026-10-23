import { expect, test } from "vitest";
import { loadObFootball, obSnapshot } from "./__tests__/obFootballOriginal";

const NOW = 1_800_000_000_000;
const before = loadObFootball(true, {}, () => NOW).api;
const after = loadObFootball(false, {}, () => NOW).api;
const meta = { mid: "5652292", tid: "180", tn: "Premier League", tnjc: "英超", startTime: NOW + 3600_000, home: "Home", away: "Away" };
export const obTestPlay = (hpid: string, hid = hpid, hv = "-0.5", odds = 1.9) => ({
  hpid, hpn: "", hl: [{ hid, hv, ol: [
    { oid: `${hid}-h`, ot: "1", ov: odds }, { oid: `${hid}-a`, ot: "2", ov: odds },
    ...(hpid === "1" || hpid === "17" ? [{ oid: `${hid}-d`, ot: "X", ov: 3.1 }] : []),
  ] }],
});
const tours = [
  { csid: "1", tid: "180", tn: "英超", mids: "5652292,2097200625505820674,5652293", mgt: NOW,
    mls: [{ mid: "5652292", mhn: "Home", man: "Away", mgt: NOW }, { mid: "5652293", me: 1 }] },
  { csid: "1", mid: "5652292", mhn: "New home", man: "New away", mgt: 0, tn: "" },
  { csid: "1", mid: "5652294", mhn: "中文主队", man: "中文客队", mvs: 1, ms: 1 },
  { csid: "1", mid: "5652295", tn: "VS- EAFC PANDA独家" },
  { csid: "2", mid: "5652296", mhn: "Other", man: "Sport" },
  null, 0, [],
];
const nestedKeys = ["mls", "matches", "matchList", "mhl", "ml", "mbm", "mbms", "ms"];
const envelopes: Array<[string, (rows: unknown[]) => unknown]> = [
  ["array", rows => rows], ["data-array", rows => ({ data: rows })], ["double-data", rows => ({ data: { data: rows } })],
  ["live", rows => ({ livedata: rows })], ["nonlive", rows => ({ nolivedata: rows })],
  ["map", rows => ({ livedata: Object.fromEntries(rows.map((r, i) => [String(i), r])) })],
  ["list", rows => ({ list: rows })], ["mixed", rows => ({ livedata: rows, nolivedata: rows })],
];
test.each(envelopes.flatMap(([name, wrap]) => [false, true].flatMap(forceLive => nestedKeys.map(key => ({ name, wrap, forceLive, key })))))(
  "schedule $name/$key/live=$forceLive preserves filtering, duplicate precedence, identities and row order", ({ wrap, forceLive, key }) => {
    const rows = structuredClone(tours) as any[];
    rows[0][key] = rows[0].mls; if (key !== "mls") delete rows[0].mls;
    const input = wrap(rows);
    expect(obSnapshot(after.collectObFootballSchedule(structuredClone(input), forceLive)))
      .toEqual(obSnapshot(before.collectObFootballSchedule(structuredClone(input), forceLive)));
  });

const marketSets = [[], [obTestPlay("1")], [obTestPlay("4"), obTestPlay("2", "totals", "2.5")],
  [obTestPlay("17"), obTestPlay("19"), obTestPlay("18")],
  [obTestPlay("4", "locked", "0.5", 0), obTestPlay("4", "duplicate", "0.5"), obTestPlay("4", "alternate", "1")],
  [obTestPlay("25"), obTestPlay("143"), obTestPlay("26"), obTestPlay("999")]];
const names = [
  { mhn: "English Home", man: "English Away" }, { mhn: "中文主队", man: "中文客队" },
  { mhn: "大", man: "小" }, { mhn: "", man: "" },
];
test.each([false, true].flatMap(isLive => [0, NOW / 1000, NOW - 24 * 3600_000, NOW + 24 * 3600_000].flatMap(startTime =>
  names.flatMap((rowNames, nameIndex) => marketSets.map((plays, marketIndex) => ({ isLive, startTime, rowNames, nameIndex, plays, marketIndex }))))))(
  "DTO live=$isLive/start=$startTime/names=$nameIndex/markets=$marketIndex retains all fields and IDs", ({ isLive, startTime, rowNames, plays }) => {
    const schedule = { ...meta, startTime, isLive };
    const row = { ...rowNames, mgt: startTime, playData: plays };
    expect(obSnapshot(after.buildObFootballListDto(structuredClone(schedule), structuredClone(row))))
      .toEqual(obSnapshot(before.buildObFootballListDto(structuredClone(schedule), structuredClone(row))));
  });
test.each([null, undefined, {}, { me: 1 }, { tme: "1" }, { mvs: 1 }, { mgt: "bad" }, { mhn: "Over", man: "Under" }])(
  "DTO incomplete/electronic odds %j preserves placeholders and exclusion", row => {
    for (const schedule of [meta, { ...meta, home: "", away: "" }, { ...meta, home: "大", away: "小" }])
      expect(obSnapshot(after.buildObFootballListDto(schedule, row))).toEqual(obSnapshot(before.buildObFootballListDto(schedule, row)));
  });
test.each([false, true].flatMap(isLive => [0, NOW + 1000, NOW - 86400_000].map(startTime => ({ isLive, startTime }))))(
  "DTO clock reads preserve count and calculation position: $isLive/$startTime", ({ isLive, startTime }) => {
    function run(original: boolean) {
      let reads = 0;
      const api = loadObFootball(original, {}, () => NOW + ++reads * 10).api;
      const dto = api.buildObFootballListDto({ ...meta, isLive, startTime }, {});
      return { dto: obSnapshot(dto), reads };
    }
    expect(run(false)).toEqual(run(true));
  });
test("odds ingestion and detail extraction retain original Map and nested row reference semantics", () => {
  function run(api: any) {
    const primary = { mid: "5652292", mhn: "Home", man: "Away", tn: "League", tnjc: "Short" };
    const nested = { mid: "5652294", mhn: "H", man: "A" };
    const decoded = { data: [primary, { mid: "5652292", mhn: "", man: "", tn: "", mhl: [nested] }] };
    const byMid = new Map();
    api.ingestOddsRows(decoded, byMid);
    const envelope = { data: [primary], playData: [obTestPlay("4")] };
    const detail = api.matchRowFromDecoded(envelope);
    return { rows: [...byMid], detail, sameDetail: detail === primary, samePlays: detail.playData === envelope.playData,
      sameUnmerged: byMid.get("5652294") === nested };
  }
  const original = loadObFootball(true).api;
  const current = loadObFootball(false).load("obSportFootballResponse");
  expect(obSnapshot(run(current))).toEqual(obSnapshot(run(original)));
});
