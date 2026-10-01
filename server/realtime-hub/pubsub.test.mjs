import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { io as ioc } from "socket.io-client";
import { attachChangmenRealtimeHub, closeChangmenRealtimeHub } from "./hub.js";
import {
  attachPubSubHandlers,
  MAX_PUBSUB_CHANNEL_LEN,
  MAX_PUBSUB_MESSAGE_LEN,
  normalizePubSubChannel,
} from "./pubsub.js";
import { Server } from "socket.io";

test("maintenance subscription and resubscription immediately receive the latest snapshot", async (t) => {
  const server = http.createServer();
  const io = new Server(server, { transports: ["websocket"] });
  const channel = "Polymarket:Maintenance";
  let snapshot = { state: "operational", checkedAt: 123 };
  io.on("connection", socket => attachPubSubHandlers(socket, {
    getSnapshot: name => name === channel ? snapshot : null,
  }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const client = ioc(`http://127.0.0.1:${server.address().port}`, { transports: ["websocket"] });
  t.after(() => { client.close(); io.close(); server.close(); });
  await new Promise(resolve => client.on("connect", resolve));
  const subscribe = async () => {
    const received = new Promise(resolve => client.once("pubsub:message", resolve));
    client.emit("pubsub:subscribe", { channel });
    return received;
  };
  assert.deepEqual(await subscribe(), { channel, content: snapshot });
  await new Promise(resolve => client.emit("pubsub:unsubscribe", { channel }, resolve));
  snapshot = { state: "unknown", checkedAt: 456, error: "timeout" };
  assert.deepEqual(await subscribe(), { channel, content: snapshot });
});

test("normalizePubSubChannel", () => {
  assert.equal(normalizePubSubChannel(" BetTarget "), "BetTarget");
  assert.equal(normalizePubSubChannel(""), null);
  assert.equal(normalizePubSubChannel("x".repeat(MAX_PUBSUB_CHANNEL_LEN + 1)), null);
});

test("pubsub publish delivers to subscriber not publisher", async () => {
  const server = http.createServer();
  attachChangmenRealtimeHub(server);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = /** @type {import("node:net").AddressInfo} */ (server.address()).port;

  const token = "test-token";
  const publisher = ioc(`http://127.0.0.1:${port}`, {
    path: "/esport/realtime/socket.io",
    transports: ["websocket"],
    auth: { token },
    extraHeaders: { token },
  });
  const subscriber = ioc(`http://127.0.0.1:${port}`, {
    path: "/esport/realtime/socket.io",
    transports: ["websocket"],
    auth: { token },
    extraHeaders: { token },
  });

  await Promise.all([
    new Promise((resolve) => publisher.on("connect", resolve)),
    new Promise((resolve) => subscriber.on("connect", resolve)),
  ]);

  const channel = "BetTarget";
  await new Promise((resolve, reject) => {
    subscriber.emit("pubsub:subscribe", { channel }, (ack) => {
      if (ack?.ok)
        resolve(undefined);
      else reject(new Error(ack?.error || "subscribe failed"));
    });
  });

  const received = new Promise((resolve) => {
    subscriber.on("pubsub:message", (packet) => {
      if (packet.channel === channel)
        resolve(packet.content);
    });
  });

  await new Promise((resolve, reject) => {
    publisher.emit("pubsub:publish", { channel, message: "{\"PB\":{\"1\":\"Home\"}}" }, (ack) => {
      if (ack?.ok)
        resolve(undefined);
      else reject(new Error(ack?.error || "publish failed"));
    });
  });

  assert.equal(await received, "{\"PB\":{\"1\":\"Home\"}}");

  let publisherGot = false;
  publisher.on("pubsub:message", () => {
    publisherGot = true;
  });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(publisherGot, false);

  publisher.close();
  subscriber.close();
  closeChangmenRealtimeHub();
  await new Promise((resolve) => server.close(resolve));
});

test("pubsub rejects oversized message", async () => {
  const server = http.createServer();
  attachChangmenRealtimeHub(server);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = /** @type {import("node:net").AddressInfo} */ (server.address()).port;

  const token = "test-token";
  const client = ioc(`http://127.0.0.1:${port}`, {
    path: "/esport/realtime/socket.io",
    transports: ["websocket"],
    auth: { token },
    extraHeaders: { token },
  });
  await new Promise((resolve) => client.on("connect", resolve));

  const ack = await new Promise((resolve) => {
    client.emit(
      "pubsub:publish",
      { channel: "BetTarget", message: "x".repeat(MAX_PUBSUB_MESSAGE_LEN + 1) },
      (response) => resolve(response),
    );
  });
  assert.equal(ack.ok, false);

  client.close();
  closeChangmenRealtimeHub();
  await new Promise((resolve) => server.close(resolve));
});
