import {
  patchDirectRealtimeStatus,
  resetDirectRealtimeStatus,
} from "../shared/directRealtimeStatus";
import { PLATFORMS } from "../shared/platforms";

const PLATFORM = PLATFORMS.TF;

export type TfWsOddsPayload = {
  data?: { market_id?: string; selection?: Array<Record<string, unknown>> };
};

/**
 * TF 实时赔率曾直连 A8 聚合 WS；已禁用（无官方/CHANGMEN 替代）。
 * HTTP 30s 轮询仍可用。返回 no-op stop。
 */
export function startTfOddsWs(_opts: {
  getToken: () => Promise<string | undefined>;
  onMessage: (payload: TfWsOddsPayload) => void;
  onError: () => void;
}): () => void {
  patchDirectRealtimeStatus(PLATFORM, {
    upstreamConnected: false,
    upstreamRoute: null,
    lastError: "TF A8 WebSocket disabled",
  });
  console.info("[TF] realtime WS disabled (no A8 aggregate); HTTP poll only");
  return () => {
    resetDirectRealtimeStatus(PLATFORM);
  };
}
