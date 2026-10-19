import type { PmSportSnapshot } from "@/types/esport";
import {
  PM_SPORT_CHANNEL,
  subscribeChangmenChannel,
} from "@changmen/venue-browser/adapter/shared";

let unsub: (() => void) | null = null;

interface PmSportPushMessage {
  ClientMatchID?: number;
  PmSport?: PmSportSnapshot;
}

/** 启动 Polymarket pm_sport 实时推送（changmen Socket.IO，已服务端对齐 Reverse） */
export async function startPmSportRealtimeFeed(
  onUpdate: (clientMatchId: number, pmSport: PmSportSnapshot) => void,
): Promise<() => void> {
  if (unsub)
    return unsub;

  unsub = await subscribeChangmenChannel(PM_SPORT_CHANNEL, (msg) => {
    const row = msg as PmSportPushMessage;
    const id = Number(row?.ClientMatchID);
    const snap = row?.PmSport;
    if (!Number.isFinite(id) || !snap || typeof snap !== "object")
      return;
    onUpdate(id, snap);
  });

  return () => {
    stopPmSportRealtimeFeed();
  };
}

export function stopPmSportRealtimeFeed() {
  unsub?.();
  unsub = null;
}
