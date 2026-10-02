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

/**
 * @param {import("node:http").Server} httpServer
 */
export function attachChangmenRealtimeHub(httpServer, { authenticate, authorize } = {}) {
  if (io)
    return io;

  io = new Server(httpServer, {
    path: REALTIME_SOCKET_PATH,
    transports: ["websocket"],
    cors: { origin: true, credentials: true },
    serveClient: false,
  });
  io.use(async (socket, next) => {
    try {
      const result = authenticate ? await authenticate(socket) : { code: "AUTH_REQUIRED" };
      if (!result?.user)
        return next(Object.assign(new Error(result?.code || "AUTH_REQUIRED"), { data: { code: result?.code || "AUTH_REQUIRED" } }));
      socket.data.userId = result.user.id;
      next();
    }
    catch {
      next(Object.assign(new Error("TEMPORARY_UNAVAILABLE"), { data: { code: "TEMPORARY_UNAVAILABLE" } }));
    }
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
    attachPubSubHandlers(socket, {
      authorize: (channel, operation, message) => Promise.resolve(authorize?.(socket, channel, operation, message)).catch(() => false),
      getSnapshot: channel => channel === PM_MAINTENANCE_CHANNEL ? pmMaintenanceSnapshot : null,
    });

    socket.on("join room", async (room) => {
      const name = String(room || "").trim();
      if (name && await Promise.resolve(authorize?.(socket, name, "subscribe")).catch(() => false))
        await socket.join(name);
    });
    const timer = setInterval(async () => {
      try {
        const current = await authenticate?.(socket);
        if (!current?.user || String(current.user.id) !== String(socket.data.userId)) {
          socket.emit("auth:ended", { code: current?.code || "SESSION_REVOKED" });
          socket.disconnect(true);
        }
        else {
          for (const room of socket.rooms) {
            if (room !== socket.id && !await authorize?.(socket, room, "subscribe"))
              await socket.leave(room);
          }
        }
      }
      catch { socket.disconnect(true); }
    }, 30_000);
    timer.unref?.();
    socket.once("disconnect", () => clearInterval(timer));
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
