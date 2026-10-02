/** @typedef {{ channel?: string; message?: string }} PubSubPayload */

export const MAX_PUBSUB_CHANNEL_LEN = 128;
export const MAX_PUBSUB_MESSAGE_LEN = 256 * 1024;

/**
 * @param {unknown} channel
 * @returns {string | null}
 */
export function normalizePubSubChannel(channel) {
  const value = String(channel ?? "").trim();
  if (!value || value.length > MAX_PUBSUB_CHANNEL_LEN)
    return null;
  return value;
}

/**
 * @param {import("socket.io").Server} io
 * @param {string} channel
 * @param {unknown} content
 */
export function emitPubSubMessage(io, channel, content) {
  const name = normalizePubSubChannel(channel);
  if (!name)
    return false;
  io.to(name).emit("pubsub:message", { channel: name, content });
  return true;
}

/**
 * BetTarget / Publish / USER:* / TRADE:* — 客户端 pub/sub（对齐 A8 GoEasy 频道语义）
 * @param {import("socket.io").Socket} socket
 * @param {{ getSnapshot?: (channel: string) => unknown }} [options]
 */
export function attachPubSubHandlers(socket, { getSnapshot, authorize = async () => true } = {}) {
  socket.on("pubsub:subscribe", async (payload, ack) => {
    const channel = normalizePubSubChannel(payload?.channel);
    if (!channel) {
      ack?.({ ok: false, error: "channel required" });
      return;
    }
    if (!await authorize(channel, "subscribe")) {
      ack?.({ ok: false, error: "FORBIDDEN" });
      return;
    }
    await socket.join(channel);
    const snapshot = getSnapshot?.(channel);
    if (snapshot != null)
      socket.emit("pubsub:message", { channel, content: snapshot });
    ack?.({ ok: true });
  });

  socket.on("pubsub:unsubscribe", (payload, ack) => {
    const channel = normalizePubSubChannel(payload?.channel);
    if (!channel) {
      ack?.({ ok: false, error: "channel required" });
      return;
    }
    socket.leave(channel);
    ack?.({ ok: true });
  });

  socket.on("pubsub:publish", async (payload, ack) => {
    const channel = normalizePubSubChannel(payload?.channel);
    const message = payload?.message;
    if (!channel) {
      ack?.({ ok: false, error: "channel required" });
      return;
    }
    if (typeof message !== "string" || message.length > MAX_PUBSUB_MESSAGE_LEN) {
      ack?.({ ok: false, error: "invalid message" });
      return;
    }
    if (!await authorize(channel, "publish", message)) {
      ack?.({ ok: false, error: "FORBIDDEN" });
      return;
    }
    socket.to(channel).emit("pubsub:message", { channel, content: message });
    ack?.({ ok: true });
  });
}
