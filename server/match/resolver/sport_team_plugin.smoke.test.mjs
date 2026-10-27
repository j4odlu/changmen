/**
 * sport_team_plugin 冒烟（不读 RDS / 不碰电竞 team_db）。
 */
import assert from "node:assert/strict";
import {
  createSportTeamPlugin,
  resolveSportTeamKey,
  sportPairKeyResolved,
} from "@changmen/team-resolver/sport_team_plugin";

assert.equal(resolveSportTeamKey("Oakland Athletics", "mlb"), "athletics");
assert.equal(resolveSportTeamKey("A's", "mlb"), "athletics");
assert.equal(resolveSportTeamKey("Athletics", "mlb"), "athletics");

const t = 1_700_000_000_000;
assert.equal(
  sportPairKeyResolved("A's", "Yankees", t, "mlb"),
  sportPairKeyResolved("Oakland Athletics", "New York Yankees", t, "mlb"),
);
assert.notEqual(
  sportPairKeyResolved("Lions", "Twins", t, "mlb"),
  sportPairKeyResolved("Lions", "Twins", t, "kbo"),
);
assert.ok(String(sportPairKeyResolved("Lions", "Twins", t, "kbo") || "").startsWith("kbo|"));

const plugin = createSportTeamPlugin({ games: ["mlb"] });
assert.equal(plugin.resolveKey("Red Sox", "mlb"), "red sox");
assert.equal(
  plugin.pairKey("Boston Red Sox", "Yankees", t, "mlb"),
  plugin.pairKey("Red Sox", "NY Yankees", t, "mlb"),
);

assert.equal(resolveSportTeamKey("曼城", "epl"), "manchester city");
assert.equal(resolveSportTeamKey("Manchester City", "epl"), "manchester city");
assert.equal(
  sportPairKeyResolved("曼城", "利物浦", t, "epl"),
  sportPairKeyResolved("Manchester City", "Liverpool", t, "epl"),
);
const footPlugin = createSportTeamPlugin({ games: ["epl", "chi"] });
assert.equal(footPlugin.resolveKey("曼城", "epl"), "manchester city");
assert.equal(footPlugin.resolveKey("上海申花", "chi"), "shanghai shenhua");

console.log("sport_team_plugin.smoke: ok");
