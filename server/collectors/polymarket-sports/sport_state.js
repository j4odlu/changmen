/**
 * [changmen 扩展] 按 clientMatchId 串行写状态；Gamma 补充，WS 接管后不降级。
 */

import { buildPmSportSnapshot } from "./parse_sport.js";

/** [changmen 扩展] 同场 WS 消息从关联赛事开始保序；不同场不互相等待。 */
export function createPmSportMessageQueue(handle) {
  const tails = new Map();
  return async function enqueue(msg) {
    const gameId = Number(msg.gameId);
    const previous = tails.get(gameId) ?? Promise.resolve();
    const pending = previous.then(() => handle(msg));
    const tail = pending.catch(() => {});
    tails.set(gameId, tail);
    try {
      return await pending;
    }
    finally {
      if (tails.get(gameId) === tail)
        tails.delete(gameId);
    }
  };
}

export function hasPmSportStatus(snapshot) {
  const status = String(snapshot?.status ?? "").trim().toLowerCase();
  return snapshot?.live === true || snapshot?.ended === true
    || ["not_started", "scheduled", "running", "inprogress", "finished", "final", "postponed", "canceled", "cancelled"].includes(status);
}

export function isWsSportState(snapshot) {
  // [changmen 扩展] 旧快照没有来源；保守保护已有有效状态，避免回退覆盖历史 WS。
  return snapshot?.source === "ws"
    || (snapshot?.source == null && hasPmSportStatus(snapshot));
}

/** @param {(id: number) => Promise<object | null>} read */
export function createPmSportStateWriter(read) {
  const states = new Map();
  return async function apply(clientMatchId, msg, source, write) {
    const id = Number(clientMatchId);
    if (!Number.isSafeInteger(id) || id <= 0 || !hasPmSportStatus(msg))
      return false;
    let state = states.get(id);
    if (!state) {
      state = { loaded: false, wsReceived: false, prev: null, written: null, tail: Promise.resolve() };
      states.set(id, state);
    }
    // 在任何异步读写之前接管，拦住仍在等待 Gamma HTTP / DB 的旧结果。
    if (source === "ws")
      state.wsReceived = true;
    const pending = state.tail.then(async () => {
      if (!state.loaded) {
        const stored = await read(id);
        state.prev = state.written = stored;
        state.wsReceived ||= isWsSportState(stored);
        state.loaded = true;
      }
      if (source === "gamma" && state.wsReceived)
        return false;
      const snapshot = { ...buildPmSportSnapshot(msg, state.prev), source };
      state.prev = snapshot;
      if (!shouldWritePmSport(snapshot, state.written))
        return false;
      const ok = await write(id, snapshot);
      if (ok)
        state.written = snapshot;
      return ok;
    });
    state.tail = pending.catch(() => {});
    return pending;
  };
}

/** @param {object} next @param {object | null} prevWritten */
export function shouldWritePmSport(next, prevWritten) {
  if (!next)
    return false;
  if (!prevWritten)
    return true;
  const keys = [
    "source",
    "gameId",
    "eventId",
    "slug",
    "status",
    "live",
    "ended",
    "period",
    "scoreRaw",
    "label",
    "finishedTimestamp",
    "currentMap",
    "elapsed",
    "resolutionSource",
  ];
  for (const key of keys) {
    if (next[key] !== prevWritten[key])
      return true;
  }
  const nh = next.mapScore?.home ?? 0;
  const na = next.mapScore?.away ?? 0;
  const ph = prevWritten.mapScore?.home ?? 0;
  const pa = prevWritten.mapScore?.away ?? 0;
  if (nh !== ph || na !== pa)
    return true;
  return false;
}
