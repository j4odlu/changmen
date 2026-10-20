import { afterEach, beforeEach, expect } from "vitest";

// The frozen FOK assertions exercise order logic, not a live Polymarket socket.
// Keep their transport fixture here so a Node-provided WebSocket cannot dial out.
class OfflineWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = OfflineWebSocket.CONNECTING;
  onopen = null;
  onmessage = null;
  onclose = null;
  onerror = null;
  send() {}
  close() { this.readyState = OfflineWebSocket.CLOSED; }
}

const isFokOrderSuite = () => expect.getState().testPath?.replaceAll("\\", "/")
  .endsWith("/venue-browser/adapter/polymarket/tests/fok/bet.test.ts");
let original: typeof WebSocket;

beforeEach(() => {
  if (!isFokOrderSuite()) return;
  original = globalThis.WebSocket;
  globalThis.WebSocket = OfflineWebSocket as unknown as typeof WebSocket;
});

afterEach(async () => {
  if (!isFokOrderSuite()) return;
  try {
    const { stopAllPolymarketUserWs } = await import("@changmen/venue-browser/polymarket/realtime/userWs");
    stopAllPolymarketUserWs();
  }
  finally {
    globalThis.WebSocket = original;
  }
});
