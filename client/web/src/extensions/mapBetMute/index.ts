/**
 * [changmen 扩展] 全场 / 各地图折叠禁下（UI + executeArbBet 早退）。
 * 含全部盘口、全场胜负、地图4独立开关；地图进入 live 后自动解除折叠。
 */

export {
  MIN_FOLDABLE_MAP,
  MAP_BET_MUTE_SESSION_KEY,
  MAP_BET_MUTE_GLOBAL_SESSION_KEY,
  MAP_BET_MUTE_FULL_MATCH_GLOBAL_SESSION_KEY,
  MAP_BET_MUTE_MAP4_GLOBAL_SESSION_KEY,
  MAP_BET_MUTE_MAP4_LIVE_OPEN_SESSION_KEY,
  MAP_BET_MUTE_GLOBAL_OPEN_SESSION_KEY,
  canFoldMap,
  muteKey,
  ensureMapBetMuteLoaded,
  mapBetMuteKeys,
  mapBetMuteGlobalOpenKeys,
  mapBetMuteGlobal,
  mapBetMuteFullMatchGlobal,
  mapBetMuteMap4Global,
  mapBetMuteMap4LiveOpenKeys,
  isMap4MuteGlobal,
  isMap4MuteGlobalActive,
  setMap4MuteGlobal,
  toggleMap4MuteGlobal,
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
