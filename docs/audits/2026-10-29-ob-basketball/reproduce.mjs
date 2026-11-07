// Read-only current-source audit. No network, database calls, writes or bet probes.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const source = relative => import(pathToFileURL(path.join(root, relative)).href);
const recorded = JSON.parse(fs.readFileSync(path.join(here, "offline_audit.json"), "utf8"));
const { getGameCodeForPlatformId } = await source("packages/shared/catalog/game_catalog.ts");
const { obSavedBetIsMatchWinner, obLegacyWinBetName } = await source("packages/shared/catalog/market_catalog.ts");
const { SaveMatchRequest } = await source("packages/api-contract/src/schemas.ts");
const { toA8SaveBetRow } = await source("client/web/src/api/collectWire.ts");
const { nativeSourcesByMap, sourceFromBet } = await source("server/match/matcher/compose/normalize/native_bets.ts");
const { isClientMatchEnded } = await source("server/match/matcher/compose/shape/ended_filter.js");
const { filterMultiPlatform } = await source("server/match/matcher/compose/shape/live_shape.js");
const { ViewBetItem } = await source("client/packages/client-core/src/models/match.ts");
const { parseMscScore, parseObSportMatchLive } = await source("client/web/src/runtime/obSportLive.ts");
const { a8StartTimeListAllowed } = await source("packages/shared/time/match_time.ts");
const { changePlan } = await source("scripts/deploy/change-plan.mjs");
const sid = "sport:5796454";
const bet = {
  Type: "OB", SourceMatchID: sid, Map: 0,
  SourceBetID: "sport:37:141303105071627307", BetName: "[全场] 独赢（含加时）",
  SourceHomeID: "sport:144025224854843616", HomeName: "Atlanta Hawks", HomeOdds: 1.84,
  SourceAwayID: "sport:146625546024230854", AwayName: "Cleveland Cavaliers", AwayOdds: 1.92,
  Status: "Normal",
};
const values = new Map();
values.set("P01", getGameCodeForPlatformId("OB", "sport:2"));
values.set("P02", { byType: obSavedBetIsMatchWinner(bet, "basketball"), byName: obLegacyWinBetName(bet.BetName) });
values.set("P03", nativeSourcesByMap("OB", sid, { [`OB:${sid}`]: [bet] }, "basketball").size);
values.set("P04", Object.keys(SaveMatchRequest.parse({ provider: "OB", matchs: "[]", snapshotScope: "sport-basketball" })));
const wire = toA8SaveBetRow({ ...bet, OddTypeID: "37", Hpid: "37", RawHid: "141303105071627307" });
values.set("P05", { oddType: "OddTypeID" in wire, hpid: "Hpid" in wire, rawHid: "RawHid" in wire });
const projected = sourceFromBet("OB", { ...bet, Hpid: "37", RawHid: "141303105071627307" });
values.set("P06", { betId: projected.BetID, homeId: projected.HomeID, hpid: "Hpid" in projected, rawHid: "RawHid" in projected });
values.set("P07", parseMscScore(["S1|94:82", "S2|52:44"]));
values.set("P08", parseObSportMatchLive({ cmd: "C302", cd: { mid: "5818549", csid: "2" } }));
values.set("P09", isClientMatchEnded({
  StartTime: Date.now() - 2 * 3600000, Round: 0, Matchs: { OB: sid, RAY: "ray-basket" },
  Bets: [{ Map: 0, Sources: { OB: { Status: "Locked" }, RAY: { Status: "Locked" } } }],
}, { OB: { [sid]: { IsLive: 1 } }, RAY: { "ray-basket": {} } }, {}, Date.now()));
values.set("P10", new ViewBetItem({
  Type: "OB", BetID: bet.SourceBetID, HomeID: bet.SourceHomeID, AwayID: bet.SourceAwayID,
  HomeOdds: 1.84, AwayOdds: 1.92, Status: "Normal",
}, sid).getOdds("Home"));
values.set("P11", String(Number("144025224854843616")) === "144025224854843616");
values.set("P12", filterMultiPlatform([{ Game: "篮球", Round: 0, Matchs: { OB: sid } }]).length);
values.set("P13", a8StartTimeListAllowed(Date.now() + 2 * 3600000));
const plan = changePlan([
  ...recorded.documentChangePlan.paths,
  "docs/audits/2026-10-29-ob-basketball/README.md",
  "docs/audits/2026-10-29-ob-basketball/reproduce.mjs",
]);
values.set("P14", { tier: plan.tier, checks: plan.checks });
for (const item of recorded.probes)
  assert.deepEqual(values.get(item.id), item.expected, `${item.id}: current source differs from the recorded baseline`);
console.log(JSON.stringify({ matchedBaseline: true, probeCount: values.size, note: "Recorded current-source behavior; not acceptance of an OB basketball implementation." }));
