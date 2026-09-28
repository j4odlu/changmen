/**
 * [changmen 扩展] 全场 / 各地图折叠禁下（UI + executeArbBet 早退）。
 * 含全部盘口总开关，以及只硬关闭全场胜负、保持地图正常的独立开关。
 */

export {
  MIN_FOLDABLE_MAP,
  MAP_BET_MUTE_SESSION_KEY,
  MAP_BET_MUTE_GLOBAL_SESSION_KEY,
  MAP_BET_MUTE_FULL_MATCH_GLOBAL_SESSION_KEY,
  MAP_BET_MUTE_GLOBAL_OPEN_SESSION_KEY,
  canFoldMap,
  muteKey,
  ensureMapBetMuteLoaded,
  mapBetMuteKeys,
  mapBetMuteGlobalOpenKeys,
  mapBetMuteGlobal,
  mapBetMuteFullMatchGlobal,
  isMapMuteGlobal,
  isFullMatchMuteGlobal,
  setFullMatchMuteGlobal,
  toggleFullMatchMuteGlobal,
  setMapMuteGlobal,
  toggleMapMuteGlobal,
  isMapMuted,
  isMapMuteActive,
  clearMapMute,
  toggleMapMute,
  resetMapBetMuteForTests,
} from "@/extensions/mapBetMute/mapBetMute";
