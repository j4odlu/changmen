import assert from "node:assert/strict";

const g = await import("./game_catalog.ts");
const gameCatalog = await import("./game_catalog.json", { with: { type: "json" } });

assert.equal(g.getGameSport("cs2"), "esport");
assert.equal(g.getGameCodeForPlatformId("IA", "3"), "cs2");
assert.equal(g.getGameCodeForPlatformId("PB", "cs2"), "cs2");
assert.equal(g.getGameCodeForPlatformId("PB", "cs-go"), "cs2");
assert.equal(g.getGameCodeForPlatformId("PB", "counter-strike"), "cs2");
assert.equal(g.getGameCodeForPlatformId("PB", "kings-of-glory"), "kog");
assert.ok(g.isAllowedPlatformGameId("PB", "cs-go"));
assert.ok(g.isAllowedPlatformGameId("PB", "cs2"));
assert.deepEqual(g.resolveClientGame("IA", "3"), { Game: "CS:GO", GameID: 3 });
assert.equal(g.getGameCodeForPlatformId("TF", "14"), "kog");
assert.equal(g.getGameCodeForPlatformId("IA", "16"), "kog");
assert.equal(g.getGameCodeForPlatformId("RAY", "140"), "cs2");
assert.equal(g.getGameCodeForPlatformId("Polymarket", "cs2"), "cs2");
assert.equal(g.getPlatformGameId("Polymarket", "lol"), "lol");
assert.equal(g.getGameCodeForPlatformId("Polymarket", "kog"), "kog");
assert.equal(g.getGameCodeForPlatformId("Polymarket", "counter-strike"), "cs2");
assert.equal(g.getGameCodeForPlatformId("Polymarket", "league-of-legends"), "lol");
assert.equal(g.getGameCodeForPlatformId("Polymarket", "dota-2"), "dota2");
assert.equal(g.getGameCodeForPlatformId("Polymarket", "honor-of-kings"), "kog");
assert.equal(g.getGameCodeForPlatformId("PredictFun", "lol"), "lol");
assert.equal(g.getGameCodeForPlatformId("PredictFun", "cs2"), "cs2");
assert.equal(g.getGameCodeForPlatformId("PredictFun", "dota2"), "dota2");
assert.deepEqual(g.resolveClientGame("PredictFun", "lol"), { Game: "英雄联盟", GameID: 1 });
assert.equal(g.getPlatformGameId("PredictFun", "valorant"), "valorant");
assert.equal(g.getGameCodeForPlatformId("Limitless", "dota-2"), "dota2");
assert.equal(g.getGameCodeForPlatformId("Limitless", "league-of-legends"), "lol");
assert.equal(g.getGameCodeForPlatformId("Limitless", "cs-go"), "cs2");
assert.equal(g.getGameCodeForPlatformId("Limitless", "cs2"), "cs2");
assert.equal(g.getGameCodeForPlatformId("SXBet", "lol"), "lol");
assert.equal(g.getGameCodeForPlatformId("SXBet", "dota2"), "dota2");
assert.equal(g.getGameCodeForPlatformId("Azuro", "1061"), "cs2");
assert.equal(g.getGameCodeForPlatformId("Azuro", "lol"), "lol");
assert.equal(g.getGameCodeForPlatformId("Azuro", "1000"), "dota2");
assert.ok(g.getActivePlatformGameIds("OB").length > 0);

assert.equal(g.getGameDisplayName("chi"), "中超");
assert.equal(g.getGameDisplayName("mlb"), "美职棒");
assert.equal(g.getGameDisplayName("英雄联盟"), "英雄联盟");
assert.equal(g.getGameDisplayName("CS2"), "CS2");
assert.equal(g.resolveGameCode("CS:GO"), "cs2");
assert.equal(g.resolveGameCode("英雄联盟"), "lol");
assert.equal(g.resolveGameCode("无畏契约"), "valorant");
assert.equal(g.resolveGameCode("中超"), "chi");
assert.equal(g.resolveGameCode("unknown-xyz"), null);
assert.equal(g.getGameSport("chi"), "football");
assert.equal(g.getPlatformGameId("Polymarket", "chi"), "chi");
assert.equal(g.getGameCodeForPlatformId("PredictFun", "epl"), "epl");
assert.ok(!g.getActivePlatformGameIds("Polymarket").includes("chi"));
assert.equal(g.listGames().filter(x => (x.sport ?? "esport") === "esport").length, gameCatalog.default.games.length);
assert.ok(g.listGames().some(x => x.code === "unknown_fb"));


const pb = await import("./pb_team_platform_id.ts");
assert.equal(pb.formatPbTeamPlatformId("cs2", "navi"), "navi@cs2");
assert.equal(pb.formatPbTeamPlatformId("cs2", "navi@cs2"), "navi@cs2");
assert.equal(pb.formatPbTeamPlatformId("cs2", "cs2:navi"), "navi@cs2");
assert.equal(pb.formatPbTeamPlatformId("", "navi"), "navi");
assert.equal(pb.formatPbTeamPlatformId("", "ilbirs", "dota2"), "ilbirs@dota-2");
assert.equal(pb.formatPbTeamPlatformId("dota2", "ilbirs", "dota2"), "ilbirs@dota-2");
assert.equal(pb.resolvePlatformTeamId("OB", "navi", "cs2"), "navi");
assert.equal(pb.resolvePlatformTeamId("PB", "navi", "cs2"), "navi@cs2");
assert.equal(pb.resolvePlatformTeamId("PB", "navi", "cs2", "cs2"), "navi@cs2");

console.log("game_catalog_smoke: ok");
