import { afterEach, describe, expect, test, vi } from "vitest";
import { startTfOddsWs } from "./ws";

describe("startTfOddsWs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("does not open WebSocket (A8 aggregate removed)", async () => {
    const WebSocketMock = vi.fn();
    vi.stubGlobal("WebSocket", WebSocketMock);

    const stop = startTfOddsWs({
      getToken: async () => "Token abc123",
      onMessage: vi.fn(),
      onError: vi.fn(),
    });

    await Promise.resolve();
    expect(WebSocketMock).not.toHaveBeenCalled();
    stop();
  });
});
