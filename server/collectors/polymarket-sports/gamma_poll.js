/**
 * [changmen 扩展] Gamma 在首次 WS 状态前补充；历史价始终独立轮询。
 */

import { fetchLinkedPolymarketPlatformMatches, fetchPmSportByClientMatchIds } from "@changmen/db";
import { fetchGammaEventById, gammaEventToSportMessage } from "./gamma_map.js";
import { collectPrematchPrices } from "./prematch_prices.js";
import { createPmSportStateWriter } from "./sport_state.js";

const applySportState = createPmSportStateWriter(async id =>
  (await fetchPmSportByClientMatchIds([id])).get(id) || null);

/** @param {number} clientMatchId @param {object} msg @param {(id:number,snap:object)=>Promise<boolean>} write */
export async function applyPmSportFromMessage(clientMatchId, msg, write) {
  return applySportState(clientMatchId, msg, "ws", write);
}

/** [changmen 扩展] 独立状态轮询，不等待历史价查询，也不覆盖已接管的 WS。 */
export async function pollLinkedGammaSportStates(write, options = {}) {
  const linked = await (options.list ?? fetchLinkedPolymarketPlatformMatches)();
  const fetchEvent = options.fetchEvent ?? fetchGammaEventById;
  const apply = options.apply ?? applySportState;
  let written = 0;
  for (const row of linked) {
    try {
      const event = await fetchEvent(row.source_match_id);
      if (!event)
        continue;
      const msg = gammaEventToSportMessage(event, row);
      if (await apply(row.match_id, msg, "gamma", write))
        written += 1;
    }
    catch (err) { console.warn(`[pm-sports] Gamma fallback event=${row.source_match_id}:`, err.message); }
  }
  return written;
}

/** [changmen 扩展] 独立历史价轮询，避免历史接口延迟拖住实时状态写入。 */
export async function pollLinkedPrematchPrices() {
  const linked = await fetchLinkedPolymarketPlatformMatches();
  let written = 0;
  for (const eventId of new Set(linked.map(row => row.source_match_id))) {
    const event = await fetchGammaEventById(eventId);
    if (!event)
      continue;
    try { written += await collectPrematchPrices(event); }
    catch (err) { console.warn(`[pm-prematch] event=${eventId}`, err.message); }
  }
  return written;
}
