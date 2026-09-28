/**
 * [changmen 扩展] 用户折叠全场或任意地图盘口：禁止该局自动/手动新开仓。
 * Map -1（非地图盘）不可折叠。状态仅 sessionStorage，不进 USERCONFIG / 服务端。
 *
 * 全局开关：可折叠所有比赛的全场 + 各地图；单行仍可单独展开（例外表）。
 * 全场胜负开关：硬关闭所有 round=0，地图仍正常；关闭时仅清全场单行 mute。
 * 关闭全部盘口全局开关时清空全部单行 mute 与例外。
 */

import { ref, type Ref } from "vue";

export const MIN_FOLDABLE_MAP = 0;
export const MAP_BET_MUTE_SESSION_KEY = "MapBetMute";
export const MAP_BET_MUTE_GLOBAL_SESSION_KEY = "MapBetMuteGlobal";
export const MAP_BET_MUTE_FULL_MATCH_GLOBAL_SESSION_KEY = "MapBetMuteFullMatchGlobal";
/** 全局折叠开启时，单独展开的 matchId:round */
export const MAP_BET_MUTE_GLOBAL_OPEN_SESSION_KEY = "MapBetMuteGlobalOpen";

const mutedKeys: Ref<Set<string>> = ref(new Set());
const globalOpenKeys: Ref<Set<string>> = ref(new Set());
const globalMuteAll: Ref<boolean> = ref(false);
const globalMuteFullMatch: Ref<boolean> = ref(false);
let loaded = false;

export function canFoldMap(round: number): boolean {
  return Number.isFinite(round) && round >= MIN_FOLDABLE_MAP;
}

export function muteKey(matchId: number, round: number): string {
  return `${matchId}:${round}`;
}

function readSessionKeySet(storageKey: string): Set<string> {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw)
      return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed))
      return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string" && x.includes(":")));
  }
  catch {
    return new Set();
  }
}

function writeSessionKeySet(storageKey: string, keys: Set<string>): void {
  try {
    if (keys.size === 0)
      sessionStorage.removeItem(storageKey);
    else
      sessionStorage.setItem(storageKey, JSON.stringify([...keys]));
  }
  catch {
    /* ignore quota / private mode */
  }
}

function readSessionFlag(storageKey: string): boolean {
  try {
    return sessionStorage.getItem(storageKey) === "1";
  }
  catch {
    return false;
  }
}

function writeSessionFlag(storageKey: string, on: boolean): void {
  try {
    if (on)
      sessionStorage.setItem(storageKey, "1");
    else
      sessionStorage.removeItem(storageKey);
  }
  catch {
    /* ignore quota / private mode */
  }
}

function clearPerRowState(): void {
  if (mutedKeys.value.size > 0) {
    mutedKeys.value = new Set();
    writeSessionKeySet(MAP_BET_MUTE_SESSION_KEY, mutedKeys.value);
  }
  if (globalOpenKeys.value.size > 0) {
    globalOpenKeys.value = new Set();
    writeSessionKeySet(MAP_BET_MUTE_GLOBAL_OPEN_SESSION_KEY, globalOpenKeys.value);
  }
}

/** 惰性加载；BetRow computed 应先读 keys / global / openKeys 以建立依赖 */
export function ensureMapBetMuteLoaded(): void {
  if (loaded)
    return;
  loaded = true;
  mutedKeys.value = readSessionKeySet(MAP_BET_MUTE_SESSION_KEY);
  globalOpenKeys.value = readSessionKeySet(MAP_BET_MUTE_GLOBAL_OPEN_SESSION_KEY);
  globalMuteAll.value = readSessionFlag(MAP_BET_MUTE_GLOBAL_SESSION_KEY);
  globalMuteFullMatch.value = readSessionFlag(MAP_BET_MUTE_FULL_MATCH_GLOBAL_SESSION_KEY);
}

/** 供 Vue computed 订阅；勿在非 UI 路径依赖其响应式 */
export function mapBetMuteKeys(): Ref<Set<string>> {
  ensureMapBetMuteLoaded();
  return mutedKeys;
}

/** 全局开启时单独展开的盘；供 Vue computed 订阅 */
export function mapBetMuteGlobalOpenKeys(): Ref<Set<string>> {
  ensureMapBetMuteLoaded();
  return globalOpenKeys;
}

/** 全局折叠（全场 + 各地图）；供 Vue computed 订阅 */
export function mapBetMuteGlobal(): Ref<boolean> {
  ensureMapBetMuteLoaded();
  return globalMuteAll;
}

/** 全局仅折叠全场（round=0）；地图盘口不受影响。 */
export function mapBetMuteFullMatchGlobal(): Ref<boolean> {
  ensureMapBetMuteLoaded();
  return globalMuteFullMatch;
}

export function isMapMuteGlobal(): boolean {
  ensureMapBetMuteLoaded();
  return globalMuteAll.value;
}

export function isFullMatchMuteGlobal(): boolean {
  ensureMapBetMuteLoaded();
  return globalMuteFullMatch.value;
}

/**
 * 一键关闭/恢复所有全场胜负。关闭时清掉全场单行折叠，地图单行状态保持不变。
 */
export function setFullMatchMuteGlobal(on: boolean): boolean {
  ensureMapBetMuteLoaded();
  globalMuteFullMatch.value = on;
  writeSessionFlag(MAP_BET_MUTE_FULL_MATCH_GLOBAL_SESSION_KEY, on);
  if (!on) {
    const next = new Set([...mutedKeys.value].filter(key => !key.endsWith(":0")));
    if (next.size !== mutedKeys.value.size) {
      mutedKeys.value = next;
      writeSessionKeySet(MAP_BET_MUTE_SESSION_KEY, next);
    }
  }
  return on;
}

export function toggleFullMatchMuteGlobal(): boolean {
  return setFullMatchMuteGlobal(!isFullMatchMuteGlobal());
}

/**
 * 打开：全局默认折叠所有可折盘；可再单行展开。
 * 关闭：关全局，并清空全部单行 mute 与例外展开。
 * @returns 是否处于全局折叠
 */
export function setMapMuteGlobal(on: boolean): boolean {
  ensureMapBetMuteLoaded();
  if (on) {
    globalMuteAll.value = true;
    writeSessionFlag(MAP_BET_MUTE_GLOBAL_SESSION_KEY, true);
    // 开启时清例外，保证「全部折」是干净起点
    if (globalOpenKeys.value.size > 0) {
      globalOpenKeys.value = new Set();
      writeSessionKeySet(MAP_BET_MUTE_GLOBAL_OPEN_SESSION_KEY, globalOpenKeys.value);
    }
    return true;
  }
  globalMuteAll.value = false;
  writeSessionFlag(MAP_BET_MUTE_GLOBAL_SESSION_KEY, false);
  clearPerRowState();
  return false;
}

/** @returns 切换后是否处于全局折叠 */
export function toggleMapMuteGlobal(): boolean {
  return setMapMuteGlobal(!isMapMuteGlobal());
}

/** 仅单行 mute 表（不含全局）；生效态请用 isMapMuteActive */
export function isMapMuted(matchId: number, round: number): boolean {
  ensureMapBetMuteLoaded();
  if (!canFoldMap(round))
    return false;
  return mutedKeys.value.has(muteKey(matchId, round));
}

/**
 * 是否生效中的折叠禁下。
 * - 非全局：单行 mute 表
 * - 全局：默认折，除非在例外展开表
 * 该局正在 live（liveRound === round）时恒为 false。
 */
export function isMapMuteActive(
  matchId: number,
  round: number,
  liveRound: number,
): boolean {
  if (liveRound !== 0 && liveRound === round)
    return false;
  if (!canFoldMap(round))
    return false;
  ensureMapBetMuteLoaded();
  const key = muteKey(matchId, round);
  if (globalMuteFullMatch.value && round === 0)
    return true;
  if (globalMuteAll.value)
    return !globalOpenKeys.value.has(key);
  return mutedKeys.value.has(key);
}

/**
 * 清除某局折叠（进入 live 时调用，避免结束后残留 mute）。
 * 全局模式下写入例外展开，使 live 结束后仍保持展开。
 */
export function clearMapMute(matchId: number, round: number): void {
  ensureMapBetMuteLoaded();
  if (!canFoldMap(round))
    return;
  const key = muteKey(matchId, round);
  if (mutedKeys.value.has(key)) {
    const next = new Set(mutedKeys.value);
    next.delete(key);
    mutedKeys.value = next;
    writeSessionKeySet(MAP_BET_MUTE_SESSION_KEY, next);
  }
  if (globalMuteAll.value && !globalOpenKeys.value.has(key)) {
    const next = new Set(globalOpenKeys.value);
    next.add(key);
    globalOpenKeys.value = next;
    writeSessionKeySet(MAP_BET_MUTE_GLOBAL_OPEN_SESSION_KEY, next);
  }
}

/**
 * 单行折叠切换。
 * - 非全局：写 mute 表
 * - 全局：写例外展开表（开=加入例外，关=移出例外）
 * @returns 切换后是否处于 muted（true=已禁止下注）
 */
export function toggleMapMute(matchId: number, round: number): boolean {
  ensureMapBetMuteLoaded();
  if (!canFoldMap(round))
    return false;
  if (globalMuteFullMatch.value && round === 0)
    return true;
  const key = muteKey(matchId, round);
  if (globalMuteAll.value) {
    const next = new Set(globalOpenKeys.value);
    if (next.has(key))
      next.delete(key);
    else
      next.add(key);
    globalOpenKeys.value = next;
    writeSessionKeySet(MAP_BET_MUTE_GLOBAL_OPEN_SESSION_KEY, next);
    return !next.has(key);
  }
  const next = new Set(mutedKeys.value);
  if (next.has(key))
    next.delete(key);
  else
    next.add(key);
  mutedKeys.value = next;
  writeSessionKeySet(MAP_BET_MUTE_SESSION_KEY, next);
  return next.has(key);
}

/** 测试用：重置内存 + session */
export function resetMapBetMuteForTests(): void {
  loaded = false;
  mutedKeys.value = new Set();
  globalOpenKeys.value = new Set();
  globalMuteAll.value = false;
  globalMuteFullMatch.value = false;
  try {
    sessionStorage.removeItem(MAP_BET_MUTE_SESSION_KEY);
    sessionStorage.removeItem(MAP_BET_MUTE_GLOBAL_SESSION_KEY);
    sessionStorage.removeItem(MAP_BET_MUTE_FULL_MATCH_GLOBAL_SESSION_KEY);
    sessionStorage.removeItem(MAP_BET_MUTE_GLOBAL_OPEN_SESSION_KEY);
  }
  catch {
    /* ignore */
  }
}
