import { AZURO_ENVIRONMENT, AZURO_WS } from "./api";
import type { AzuroCondition } from "./parse";

export type AzuroWsStatus = "disconnected" | "connecting" | "connected" | "error";
type AzuroWsStatusListener = (status: AzuroWsStatus) => void;

let azuroWsStatus: AzuroWsStatus = "disconnected";
const azuroWsStatusListeners = new Set<AzuroWsStatusListener>();

function setAzuroWsStatus(status: AzuroWsStatus) {
  if (azuroWsStatus === status)
    return;
  azuroWsStatus = status;
  for (const fn of azuroWsStatusListeners)
    fn(status);
}

export function getAzuroWsStatus(): AzuroWsStatus {
  return azuroWsStatus;
}

export function onAzuroWsStatus(fn: AzuroWsStatusListener): () => void {
  azuroWsStatusListeners.add(fn);
  return () => azuroWsStatusListeners.delete(fn);
}

export interface AzuroConditionWsHandle {
  subscribeConditionIds(ids: string[]): void;
  stop(): void;
}

/** Azuro 官方 ConditionUpdated 推送（Match Winner 赔率增量） */
export function startAzuroConditionWs(opts: {
  onCondition: (condition: AzuroCondition) => void;
}): AzuroConditionWsHandle {
  let stopped = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let subscribedIds: string[] = [];

  function sendSubscribe(ids: string[]) {
    if (!socket || socket.readyState !== WebSocket.OPEN || !ids.length)
      return;
    socket.send(JSON.stringify({
      event: "SubscribeConditions",
      data: {
        conditionIds: ids,
        environment: AZURO_ENVIRONMENT,
      },
    }));
  }

  function connect() {
    if (stopped)
      return;
    setAzuroWsStatus("connecting");
    socket = new WebSocket(AZURO_WS);

    socket.onopen = () => {
      setAzuroWsStatus("connected");
      sendSubscribe(subscribedIds);
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data));
        if (payload?.event !== "ConditionUpdated")
          return;
        const data = payload.data as AzuroCondition | undefined;
        if (data?.conditionId || data?.id)
          opts.onCondition(data);
      }
      catch (err) {
        console.warn("[Azuro WS] message parse error", err);
      }
    };

    socket.onerror = () => {
      setAzuroWsStatus("error");
    };

    socket.onclose = () => {
      socket = null;
      setAzuroWsStatus(stopped ? "disconnected" : "error");
      if (!stopped) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, 5000);
      }
    };
  }

  connect();

  return {
    subscribeConditionIds(ids: string[]) {
      subscribedIds = [...new Set(ids.filter(Boolean))];
      sendSubscribe(subscribedIds);
    },
    stop() {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      socket?.close();
      socket = null;
      setAzuroWsStatus("disconnected");
    },
  };
}
