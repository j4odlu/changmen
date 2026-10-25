import type { SportMessage, StateSource, StoredSportSnapshot } from "./types.ts";
import { writePlatformPmSports } from "@changmen/db";
import { buildPmSportSnapshot } from "./parse_sport.ts";
import { hasPmSportStatus } from "./sport_state.ts";

/** 保留已收到的消息，不增加 HTTP/WS 请求，也不依赖 clientMatchId。 */
export function sourceEventSnapshot(msg: SportMessage, source: StateSource): StoredSportSnapshot | null {
  const eventId = String(msg.eventId ?? msg.event_id ?? "").trim();
  if (!eventId || !hasPmSportStatus(msg)) return null;
  return { ...buildPmSportSnapshot(msg), eventId, source };
}

export async function persistSourceEventStates(messages: SportMessage[], source: StateSource): Promise<number> {
  const snapshots = messages.map(msg => sourceEventSnapshot(msg, source))
    .filter((snapshot): snapshot is StoredSportSnapshot => snapshot != null);
  return writePlatformPmSports(snapshots);
}
