export type * from "./types.ts";
/**
 * 合场共享工具（@changmen/match-identity）：client_match ID、队伍键与时间窗。
 */

export {
  assignMatchIds,
  ensureClientMatchId,
  findLinkedClientIdFromMatchs,
  findReuseIdByMatchsSuperset,
  findReuseIdByPlatformOverlap,
  manualMergeKey,
  matchsIsSubset,
  matchsSignature,
  resolveClientMatchIds,
} from "./ids/client_match_ids.ts";
export { resolveCanonicalTeamName } from "./teams/canonical_ob_name.ts";
export * from "./teams/match_utils.ts";
export {
  pickCanonicalPlatformRow,
  PROVIDER_PRIORITY,
  providerPriority,
  resolveCanonicalSideNames,
  sortByProviderPriority,
  teamsFromPlatformRows,
  titleFromPlatformRow,
} from "./teams/provider_priority.ts";
export * from "./teams/team_key.ts";
export {
  MERGE_ID_START_TIME_TOLERANCE_MS,
  MERGE_START_TIME_TOLERANCE_MS,
  startTimesCompatible,
  startTimesCompatibleStrict,
} from "./time_windows.ts";
