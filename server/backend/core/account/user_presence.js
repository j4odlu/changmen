import { hasProfileMetadataStorage, persistUserPresence } from "@changmen/db/profile_metadata.js";
import { readJsonFile } from "@changmen/storage/json_file_store.js";

/** 与 A8 Client_GetUsers 一致：30 分钟内活跃视为在线 */
export const ONLINE_WINDOW_MS = 30 * 60 * 1000;

/** @type {Map<string, number>} */
const lastActive = new Map();
/** @type {Set<string>} */
const dirtyForRds = new Set();
let rdsPersistTimer = null;
let legacySessionsMigrated = false;

const RDS_PERSIST_DEBOUNCE_MS = 60_000;

function normalizeUid(userId) {
  return String(userId || "").trim().toLowerCase();
}

function readPrefLastActiveAt(profileRow) {
  const prefs = profileRow?.preferences;
  if (!prefs || typeof prefs !== "object" || Array.isArray(prefs))
    return 0;
  return Number(prefs.lastActiveAt) || 0;
}

async function flushPresenceToRds(userIds) {
  if (!hasProfileMetadataStorage() || !userIds.length)
    return;
  const now = Date.now();
  for (const uid of userIds) {
    const ts = lastActive.get(uid);
    if (!ts)
      continue;
    try {
      await persistUserPresence(uid, ts, now);
    }
    catch {
      /* RDS 写入失败不影响内存在线判定 */
    }
  }
}

function scheduleRdsPersist() {
  if (rdsPersistTimer)
    return;
  rdsPersistTimer = setTimeout(() => {
    rdsPersistTimer = null;
    const batch = [...dirtyForRds];
    dirtyForRds.clear();
    void flushPresenceToRds(batch);
  }, RDS_PERSIST_DEBOUNCE_MS);
  if (typeof rdsPersistTimer.unref === "function")
    rdsPersistTimer.unref();
}

/**
 * 一次性：legacy storage/sessions.json → profiles.preferences.lastActiveAt
 * 幂等，可重复执行；仅在新值更大时更新。
 */
export async function migrateLegacySessionsJsonToRds() {
  if (legacySessionsMigrated)
    return { migrated: 0, skipped: true };
  legacySessionsMigrated = true;

  if (!hasProfileMetadataStorage())
    return { migrated: 0, skipped: true, reason: "no_db" };

  const sessions = readJsonFile("sessions", {});
  const entries = Object.values(sessions || {}).filter(s => s?.userId);
  if (!entries.length)
    return { migrated: 0 };

  let migrated = 0;
  const now = Date.now();
  for (const session of entries) {
    const uid = normalizeUid(session.userId);
    const ts = Number(session.lastActiveAt ?? session.createdAt ?? 0);
    if (!uid || !ts)
      continue;
    try {
      const changed = await persistUserPresence(uid, ts, now, { onlyIfNewer: true });
      if (changed)
        migrated += 1;
      const prev = lastActive.get(uid) || 0;
      if (ts > prev)
        lastActive.set(uid, ts);
    }
    catch {
      /* 单条失败不阻塞其余 */
    }
  }
  if (migrated > 0) {
    console.log(`[presence] legacy sessions.json → RDS: ${migrated} 条`);
  }
  return { migrated };
}

/** 用户发起已鉴权请求或登录成功时刷新活跃时间 */
export function touchUserPresence(userId) {
  if (!userId)
    return;
  const uid = normalizeUid(userId);
  lastActive.set(uid, Date.now());
  dirtyForRds.add(uid);
  scheduleRdsPersist();
}

export function getUserLastActiveAt(userId) {
  return lastActive.get(normalizeUid(userId)) || 0;
}

export function getOnlineUserIdSet(now = Date.now()) {
  const online = new Set();
  for (const [uid, ts] of lastActive) {
    if (now - ts < ONLINE_WINDOW_MS)
      online.add(uid);
  }
  return online;
}

export function isUserOnline(userId, now = Date.now()) {
  const ts = getUserLastActiveAt(userId);
  return ts > 0 && now - ts < ONLINE_WINDOW_MS;
}

/** 管理端 / Client_GetUsers：合并进程内缓存与 profiles.preferences.lastActiveAt */
export function resolvePresenceState(userId, profileRow = null, now = Date.now()) {
  const lastActiveAt = Math.max(
    getUserLastActiveAt(userId),
    readPrefLastActiveAt(profileRow),
  );
  const isOnline = lastActiveAt > 0 && now - lastActiveAt < ONLINE_WINDOW_MS ? 1 : 0;
  return { lastActiveAt, isOnline };
}
