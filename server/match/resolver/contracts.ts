import type { TeamLookupMethods } from "@changmen/match-identity/types";
import { loadAndCreatePlugin } from "@changmen/team-resolver/team_db";
import { createSportTeamPlugin, resolveSportTeamKey } from "@changmen/team-resolver/sport_team_plugin";

// Compile-only consumer contract; this function never opens a database.
export async function checkPluginContracts() {
  const plugin = await loadAndCreatePlugin();
  const injected: TeamLookupMethods = plugin;
  injected.lookupById?.("OB", 12);
  plugin.saveMapping("100001", "OB", 12, "Team", "lol");
  const sport = createSportTeamPlugin({ games: ["mlb", "epl"] });
  const key: string | null = sport.pairKey("A", "B", 1700000000000, "mlb");
  const name: string = resolveSportTeamKey("曼城", "epl");
  // @ts-expect-error A platform identifier is a string or number.
  plugin.lookupById("OB", {});
  // @ts-expect-error Games must be supplied as a list.
  createSportTeamPlugin({ games: "mlb" });
  // @ts-expect-error The pair contract requires a numeric timestamp.
  sport.pairKey("A", "B", "1700000000000");
  return { key, name };
}
