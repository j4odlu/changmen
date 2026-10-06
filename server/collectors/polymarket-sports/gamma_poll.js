/**
 * Sports WS 状态写入与独立的 Gamma 历史价轮询。
 * [changmen 扩展] Gamma 仅用于历史价，不写入 pm_sport，避免旧比分覆盖 WS。
 */

import { fetchLinkedPolymarketPlatformMatches } from "@changmen/db";
import { fetchGammaEventById } from "./gamma_map.js";
import { buildPmSportSnapshot } from "./parse_sport.js";
import { collectPrematchPrices } from "./prematch_prices.js";
import {
  getLastWrittenSportState,
  getPrevSportState,
  setLastWrittenSportState,
  setPrevSportState,
  shouldWritePmSport,
} from "./sport_state.js";

/** @param {number} clientMatchId @param {object} msg @param {(id:number,snap:object)=>Promise<boolean>} write */
export async function applyPmSportFromMessage(clientMatchId, msg, write) {
  const gameId = msg?.gameId != null ? Number(msg.gameId) : null;
  const stateKey = Number.isFinite(gameId) ? gameId : clientMatchId;

  const prev = getPrevSportState(stateKey);
  const snapshot = buildPmSportSnapshot(msg, prev);
  setPrevSportState(stateKey, snapshot);

  const lastWritten = getLastWrittenSportState(stateKey);
  if (!shouldWritePmSport(snapshot, lastWritten))
    return false;

  const ok = await write(clientMatchId, snapshot);
  if (ok)
    setLastWrittenSportState(stateKey, snapshot);
  return ok;
}

/** [changmen 扩展] 独立历史价轮询，避免历史接口延迟拖住实时状态写入。 */
export async function pollLinkedPrematchPrices() {
  const linked = await fetchLinkedPolymarketPlatformMatches();
  let written = 0;
  for (const eventId of new Set(linked.map(row => row.source_match_id))) {
    const event = await fetchGammaEventById(eventId);
    if (!event) continue;
    try { written += await collectPrematchPrices(event); }
    catch (err) { console.warn(`[pm-prematch] event=${eventId}`, err.message); }
  }
  return written;
}
