import { fetchClientMatchRow } from "@changmen/db";
import { alignPmSportSnapshot } from "@changmen/polymarket-sports/parse_sport.js";
import { PM_SPORT_CHANNEL } from "./channels.js";

const PM_PLATFORM = "Polymarket";
const broadcastTails = new Map();

/**
 * @param {object | null | undefined} row
 * @returns {boolean}
 */
function reverseIncludesPolymarket(row) {
  const rev = row?.reverse ?? row?.Reverse;
  return Array.isArray(rev) && rev.map(String).includes(PM_PLATFORM);
}

/**
 * @param {number} clientMatchId
 * @param {object} pmSport PM 原生快照
 * @param {typeof fetchClientMatchRow} [readRow]
 * @returns {Promise<object | null>} Title 对齐后的 payload
 */
export async function buildPmSportPushPayload(clientMatchId, pmSport, readRow = fetchClientMatchRow) {
  const id = Number(clientMatchId);
  if (!Number.isFinite(id) || !pmSport || typeof pmSport !== "object")
    return null;

  const row = await readRow(id, "id, reverse, matchs, pm_sport");
  if (!row)
    return null;

  const matchs = row.matchs || {};
  if (!Object.hasOwn(matchs, PM_PLATFORM))
    return null;

  // [changmen 扩展] 通知请求超时后仍可能到达；始终推送已存储的最新状态。
  const current = row.pm_sport ?? pmSport;
  const aligned = reverseIncludesPolymarket(row)
    ? alignPmSportSnapshot(current, true)
    : current;

  return {
    ClientMatchID: id,
    PmSport: aligned,
  };
}

/**
 * @param {(channel: string, message: unknown) => void} emit
 * @param {number} clientMatchId
 * @param {object} pmSport
 * @param {typeof fetchClientMatchRow} [readRow]
 */
export async function broadcastPmSportUpdate(emit, clientMatchId, pmSport, readRow = fetchClientMatchRow) {
  const id = Number(clientMatchId);
  // [changmen 扩展] 按比赛串行读库和推送，防止旧通知的慢查询晚于新状态广播。
  const previous = broadcastTails.get(id) ?? Promise.resolve();
  const pending = previous.then(async () => {
    const payload = await buildPmSportPushPayload(id, pmSport, readRow);
    if (!payload)
      return false;
    emit(PM_SPORT_CHANNEL, payload);
    return true;
  });
  const tail = pending.catch(() => {});
  broadcastTails.set(id, tail);
  try {
    return await pending;
  }
  finally {
    if (broadcastTails.get(id) === tail)
      broadcastTails.delete(id);
  }
}
