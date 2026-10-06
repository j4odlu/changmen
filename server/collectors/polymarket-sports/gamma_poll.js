/**
 * 已关联 PM 场：Gamma REST 轮询（电竞常不在 Sports WS 推送里）
 */

import { fetchLinkedPolymarketPlatformMatches } from "@changmen/db";
import { fetchGammaEventById, gammaEventToSportMessage } from "./gamma_map.js";
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

export async function pollLinkedPmSportFromGamma(write) {
  const linked = await fetchLinkedPolymarketPlatformMatches();
  if (!linked.length)
    return 0;

  let written = 0;
  for (const row of linked) {
    const event = await fetchGammaEventById(row.source_match_id);
    if (!event)
      continue;
    const msg = gammaEventToSportMessage(event, { home: row.home, away: row.away });
    if (!msg)
      continue;
    // source_match_id 多为 Gamma event.id；写入 snapshot 供归档身份校验
    if (!msg.eventId && row.source_match_id)
      msg.eventId = String(row.source_match_id);
    const ok = await applyPmSportFromMessage(row.match_id, msg, write);
    if (ok) {
      written += 1;
      console.log(
        `[pm-sports] poll cm=${row.match_id} event=${row.source_match_id} ${msg.score || ""} ${msg.period || ""}`,
      );
    }
  }
  return written;
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
