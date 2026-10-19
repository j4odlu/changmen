import { saveVenueOdds, isVenueOdds, updateVenueBetLock } from "@changmen/client-core/bridge/oddsAccess";
import { PLATFORMS } from "../shared/platforms";
import { useMatchStore } from "../shared/webBridge";

import { iaWsPlayLocked } from "./shared/parse_fields";
import type { IaRealtimeMessage } from "./realtime";

const PLATFORM = PLATFORMS.IA;

export function handleIaRealtimeMessage(msg: IaRealtimeMessage, now = Date.now()): void {
  const matchStore = useMatchStore();
  const type = msg.message_type;
  const content = (msg.content ?? {}) as Record<string, unknown>;

  if (type === "message_type_bet_item_single_lock") {
    const playId = content.play_id;
    if (!playId) return;
    updateVenueBetLock(PLATFORM, String(playId), iaWsPlayLocked(content.status));
    matchStore.refreshOddsOnBets();
    return;
  }

  if (type === "message_type_push_point_change") {
    const pointId = String(content.point_id ?? "");
    if (!pointId || !isVenueOdds(PLATFORM, pointId)) return;
    // [A8 可证实] new Xn(pointId, point, false) — 无 betId
    saveVenueOdds(
      PLATFORM,
      {
        id: pointId,
        odds: Number(content.point) || 0,
        isLock: false,
        time: now,
      },
      "mqtt",
    );
    matchStore.refreshOddsOnBets();
  }
}
