/** Public entry for RDS team lookup and pure sport team rules. */
export { loadAndCreatePlugin } from "./team_db.ts";
export {
  baseNormSportTeamName,
  createSportTeamPlugin,
  normFootballTeamName,
  resolveSportTeamKey,
  sportPairKeyResolved,
} from "./sport_team_plugin.ts";
export type { SportTeamPlugin, TeamResolverPlugin } from "./types.ts";
