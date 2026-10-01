import { Server } from "socket.io";
import { PM_MAINTENANCE_CHANNEL, REALTIME_SOCKET_PATH } from "./channels.js";
import { startPmMaintenanceWatcher } from "./pm_maintenance.js";
import { broadcastPmSportUpdate } from "./pm_sport_broadcast.js";
import { attachPubSubHandlers, emitPubSubMessage } from "./pubsub.js";

/** @type {import("socket.io").Server | null} */
let io = null;

/** @type {((channel: string, message: unknown) => void) | null} */
let emitChannel = null;

/** @type {(() => void) | null} */
let stopPmMaintenanceWatcher = null;

/** [changmen 扩展] 官网检测快照：新订阅/重连立即回传，避免等待下一轮轮询。 */
let pmMaintenanceSnapshot = null;

function requireToken(socket) {
  const token
    = (typeof socket.handshake.auth?.token === "string" && socket.handshake.auth.token)
      || (typeof socket.handshake.headers?.token === "string" && socket.handshake.headers.token)
      || "";
  return token.trim().length > 0;
}

/**
 * @param {import("node:http").Server} httpServer
 */
export function attachChangmenRealtimeHub(httpServer) {
  if (io)
    return io;

  io = new Server(httpServer, {
    path: REALTIME_SOCKET_PATH,
    transports: ["websocket"],
    cors: { origin: true, credentials: true },
    serveClient: false,
  });

  emitChannel = (channel, message) => {
    if (!io)
      return;
    emitPubSubMessage(io, channel, message);
  };

  stopPmMaintenanceWatcher = startPmMaintenanceWatcher({
    emit: (channel, message) => {
      pmMaintenanceSnapshot = message;
      emitChannel?.(channel, message);
    },
  });

  io.on("connection", (socket) => {
    if (!requireToken(socket)) {
      socket.disconnect(true);
      return;
    }

    attachPubSubHandlers(socket, {
      getSnapshot: channel => channel === PM_MAINTENANCE_CHANNEL ? pmMaintenanceSnapshot : null,
    });

    socket.on("join room", (room) => {
      const name = String(room || "").trim();
      if (name)
        socket.join(name);
    });
  });

  return io;
}

export function getChangmenRealtimeHub() {
  return io;
}

/**
 * @param {number} clientMatchId
 * @param {object} pmSport
 */
export async function pushPmSportToBrowsers(clientMatchId, pmSport) {
  if (!emitChannel)
    return false;
  return broadcastPmSportUpdate(emitChannel, clientMatchId, pmSport);
}

export function closeChangmenRealtimeHub() {
  stopPmMaintenanceWatcher?.();
  stopPmMaintenanceWatcher = null;
  pmMaintenanceSnapshot = null;
  io?.close();
  io = null;
  emitChannel = null;
}
