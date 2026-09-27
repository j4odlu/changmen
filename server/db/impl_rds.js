/**
 * impl_rds — RDS 数据层 facade（按 domain 拆至 rds/*_store.js）。
 *
 * 命名约定：
 *   fetch*  — async 读取，返回数据或 null/[]
 *   write*  — fire-and-forget 写入，不阻塞调用方
 *   upsert* — async 写入，需要确认结果
 */

export {
  authGetUser,
  authPeekAccessToken,
  authRefreshToken,
  authSignIn,
  authSignOut,
  isAuthConfigured,
  recordAuthAudit,
} from "./rds/auth_store.js";

export {
  fetchClientMatches,
  fetchClientMatchesAll,
  fetchClientMatchesForAlign,
  fetchClientMatchesMeta,
  initLastWrittenIds,
  writeClientMatches,
  writeClientMatchesAsync,
} from "./rds/client_matches_store.js";

export {
  resolveClientMatchIdForPmSport,
  updateClientMatchPmSport,
  fetchPmSportByClientMatchIds,
  fetchLinkedPolymarketPlatformMatches,
} from "./rds/pm_sport_store.js";

export {
  deleteMoneyLogById,
  deleteMoneyLogsByPlayer,
  fetchAllMoneyLogs,
  fetchMoneyLogById,
  fetchMoneyLogsByPlayer,
  fetchMoneyLogsForMonthAggregate,
  upsertMoneyLog,
} from "./rds/money_log_store.js";

export {
  deleteOrdersByIds,
  deletePolymarketSellOrders,
  fetchAccountAnalytics,
  fetchArbOddsAnalytics,
  fetchValueBetOrderAnalytics,
  fetchPolymarketOrderAnalytics,
  fetchPolymarketOrdersInRange,
  fetchPolymarketOrderStatsInRange,
  fetchArbPairAnalytics,
  fetchGameAnalytics,
  fetchHourlyAnalytics,
  fetchOrderByOrderId,
  fetchOrdersAdminAll,
  fetchOrdersAdminPage,
  fetchOrdersAdminStats,
  fetchUnifiedFootballOrdersAdmin,
  fetchOrdersByDate,
  fetchOrdersByDatePage,
  fetchOrdersByLink,
  fetchOrdersByLinks,
  fetchOrdersByUserOrderIds,
  fetchPredictionSellsByBuyOrderIds,
  fetchOrdersByPlayer,
  fetchOrdersByPlayerStrict,
  fetchOrdersByPlayerAll,
  fetchOrdersByPlayerOrderIds,
  fetchOrdersByPlayerOrderIdsStrict,
  fetchOrdersForMonthAggregate,
  fetchOrdersForProfitAggregate,
  fetchPlatformAnalytics,
  fetchUserById,
  fetchUserByName,
  setOrdersBoundHook,
  setOrdersInsertedHook,
  updateOrderBind,
  rebindOrderLink,
  upsertOrders,
  claimCreditPfPendingOrderRow,
  adjustPfSellProceedsAfterFeeRow,
} from "./rds/orders_store.js";

export {
  fetchLiveTimers,
  fetchPlatformCollectorMeta,
  fetchPlatformBets,
  fetchPlatformMatches,
  purgePlatformLiveTimers,
  replacePlatformBetsForMatch,
  replacePlatformBetsForMatchAsync,
  syncPlatformBetsForMatchAsync,
  deleteOrphanPlatformBetsAsync,
  setPlatformMatchId,
  clearPlatformMatchIdsForClientMatchIds,
  clearPlatformMatchIdsPointingAtEnded,
  writeLiveTimers,
  writeLiveTimersAsync,
  writePlatformBets,
  writePlatformMatches,
  writePlatformMatchesAsync,
  prunePolymarketPlatformMatches,
  prunePredictFunPlatformMatches,
  prunePlatformMatchesByStartBefore,
  markClientMatchesEndedByStartBefore,
  pruneMatchesOlderThanTwoDays,
  pruneMatchesOlderThanCollectPast,
  PLATFORM_MATCH_PAST_PRUNE_MS,
  PB_SNAPSHOT_ORPHAN_GRACE_MS,
  collectorMatchesWriteKey,
  collectorBetsWriteKey,
  collectorTimersWriteKey,
  isStickyPlatformMatchSnapshot,
  shouldIgnoreEmptyPlatformMatchSnapshot,
  platformMatchOrphanCutoffMs,
  resolveSnapshotOrphanBeforeMs,
} from "./rds/platform_collector_store.js";

export {
  countActivePlayersByOwner,
  fetchAccountRecordsByOwner,
  fetchAccountRecordsByOwnerStrict,
  fetchDeletedAccountRecordsByOwner,
  fetchPolymarketPlayersForTradeLookup,
  fetchPlayerByPlatformAndName,
  fetchPlayerByPlatformNameAndPlayerName,
  fetchPlayerByProviderAndVenueMemberId,
  fetchPlayerById,
  fetchPlayersByIds,
  fetchPlayersByIdsIncludingDeleted,
  fetchTagPlatforms,
  fetchBettingUserLogsInRange,
  fetchUserLogsInRange,
  insertPlayerRow,
  insertUserLogRow,
  patchPlayerAccountRecord,
  saveAccountRecordsForOwner,
  savePlayerAccountRecord,
  batchSavePlayerAccountRecords,
  softDeletePlayerRow,
  softDeletePlayersNotInList,
  updatePlayerBalanceRow,
  debitPlayerBalanceRow,
  creditPlayerBalanceRow,
  rechargePlayerBalanceWithMoneyLogRow,
  updatePlayerDisplayName,
  batchUpdatePlayerDisplayNames,
  findVenueAccountKeyConflict,
  findVenueAccountKeyConflictStrict,
  fetchPlayerByVenueAccountKey,
  fetchPlayerByVenueAccountKeyStrict,
  resurrectPlayerRow,
  upsertTagPlatformByName,
} from "./rds/player_store.js";

export {
  deleteTeam,
  fetchProfileById,
  fetchProfiles,
  fetchProfilesAdmin,
  fetchTeams,
  insertProfile,
  updateUserIsAdmin,
  updateUserName,
  updateUserRole,
  updateUserTeamId,
  upsertTeam,
  writeAccounts,
  writeProfile,
  writeProfileAsync,
  writeUserMetadata,
} from "./rds/profile_store.js";

export {
  fetchSportClientMatches,
  fetchSportClientMatchVenueOverrides,
  replaceSportClientMatches,
  SPORT_MATCHER_TABLES,
  upsertSportClientMatchVenueOverride,
  writeSportClientMatchesAsync,
} from "./rds/sport_client_matches_store.js";

export {
  fetchSportVenueBets,
  fetchSportVenueMatches,
  pruneSportVenueSnapshot,
  setSportVenueMatchId,
  upsertSportVenueBets,
  upsertSportVenueMatches,
  writeSportVenueBetsAsync,
  writeSportVenueMatchesAsync,
} from "./rds/sport_venue_store.js";

export {
  fetchAllSportCanonicalTeams,
  fetchAllSportTeamVenueMaps,
  nextSportManualGbTeamId,
  saveSportTeamMappingFireAndForget,
  upsertSportCanonicalTeam,
  upsertSportTeamVenueMap,
} from "./rds/sport_team_store.js";

export {
  deleteFootballOrdersByIds,
  fetchFootballOrdersAdmin,
  fetchFootballOrderByVenueOrderId,
  fetchFootballOrdersByUser,
  fetchFootballOrdersForMonthAggregate,
  fetchOpenFootballOrdersByUser,
  patchFootballOrderStatus,
  upsertFootballOrder,
} from "./rds/football_orders_store.js";

export {
  finalizePodBetExecution,
  reservePodBetExecution,
} from "./rds/pod_bet_execution_store.js";
