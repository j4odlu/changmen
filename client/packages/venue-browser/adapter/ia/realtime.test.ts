import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  createIaRealtimeClient,
  isIaOfficialOriginHopeless,
  IA_FAILOVER_COOLDOWN_MS,
  type IaRealtimeMessage,
} from "./realtime";

import { changmenDevBackendOrigin } from "../shared/changmenWsBase";
import {
  IA_OFFICIAL_WS,
  IA_OFFICIAL_WS_PATH,
  IA_WS_FORWARD_PATH,
} from "./wsConfig";

const { ioMock } = vi.hoisted(() => ({
  ioMock: vi.fn(),
}));

vi.mock("socket.io-client", () => ({
  io: ioMock,
}));

function mockSocket() {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  const socket = {
    connected: false,
    on(event: string, fn: (...args: unknown[]) => void) {
      (handlers[event] ||= []).push(fn);
      return this;
    },
    emit: vi.fn(),
    removeAllListeners: vi.fn(),
    disconnect: vi.fn(() => {
      socket.connected = false;
    }),
    fire(event: string, ...args: unknown[]) {
      for (const fn of handlers[event] || []) fn(...args);
    },
  };
  ioMock.mockReturnValue(socket);
  return socket;
}

describe("isIaOfficialOriginHopeless", () => {
  test("true when page is localhost", () => {
    expect(
      isIaOfficialOriginHopeless("https://ilustre-analytics.org", "http://localhost:5174"),
    ).toBe(true);
  });

  test("false when page matches gateway", () => {
    expect(
      isIaOfficialOriginHopeless(
        "https://ilustre-analytics.org",
        "https://ilustre-analytics.org",
      ),
    ).toBe(false);
  });
});

describe("createIaRealtimeClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  test("starts on official socket.ajj123.net then RoomJoin", async () => {
    vi.stubGlobal("location", { origin: "https://ilustre-analytics.org" });
    const socket = mockSocket();
    const client = createIaRealtimeClient("https://ilustre-analytics.org");
    await client.start(() => {});

    expect(ioMock).toHaveBeenCalledWith(
      IA_OFFICIAL_WS,
      expect.objectContaining({
        transports: ["websocket"],
        path: IA_OFFICIAL_WS_PATH,
        reconnection: false,
        withCredentials: true,
        extraHeaders: { Origin: "https://ilustre-analytics.org" },
        auth: { token: "123" },
      }),
    );

    socket.connected = true;
    socket.fire("connect");
    expect(socket.emit).toHaveBeenCalledWith("RoomJoin", {
      room_type: "room_type_index_content_push",
    });

    await client.stop();
    expect(socket.disconnect).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  test("delivers roomMessageCallBack payloads", async () => {
    vi.stubGlobal("location", { origin: "https://ilustre-analytics.org" });
    const socket = mockSocket();
    const messages: IaRealtimeMessage[] = [];
    const client = createIaRealtimeClient("https://ilustre-analytics.org");
    await client.start((message) => messages.push(message));

    socket.connected = true;
    socket.fire("connect");
    socket.fire("roomMessageCallBack", {
      message_type: "message_type_push_point_change",
      content: { point_id: "p1" },
    });

    expect(messages).toEqual([
      { message_type: "message_type_push_point_change", content: { point_id: "p1" } },
    ]);
    await client.stop();
    vi.unstubAllGlobals();
  });

  test("on localhost skips official and starts on CHANGMEN", async () => {
    vi.stubGlobal("location", { origin: "http://localhost:5174" });
    const changmen = mockSocket();
    ioMock.mockReturnValueOnce(changmen);

    const client = createIaRealtimeClient("https://ilustre-analytics.org");
    await client.start(() => {});

    expect(ioMock).toHaveBeenCalledTimes(1);
    expect(ioMock).toHaveBeenCalledWith(
      changmenDevBackendOrigin(),
      expect.objectContaining({
        path: IA_WS_FORWARD_PATH,
        extraHeaders: {
          Origin: "https://ilustre-analytics.org",
          token: "hello",
        },
        auth: { token: "https://ilustre-analytics.org" },
      }),
    );

    await client.stop();
    vi.unstubAllGlobals();
  });

  test("on matching origin falls back to CHANGMEN when official fails", async () => {
    vi.stubGlobal("location", { origin: "https://ilustre-analytics.org" });
    const official = mockSocket();
    const changmen = mockSocket();
    ioMock.mockReturnValueOnce(official).mockReturnValueOnce(changmen);

    const client = createIaRealtimeClient("https://ilustre-analytics.org");
    await client.start(() => {});

    official.fire("connect_error", new Error("official down"));
    await Promise.resolve();
    await Promise.resolve();

    expect(ioMock).toHaveBeenCalledTimes(2);
    expect(ioMock).toHaveBeenLastCalledWith(
      changmenDevBackendOrigin(),
      expect.objectContaining({
        path: IA_WS_FORWARD_PATH,
      }),
    );

    await client.stop();
    vi.unstubAllGlobals();
  });

  test("on localhost retries CHANGMEN with cooldown instead of cycling to official", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("location", { origin: "http://localhost:5174" });
    const first = mockSocket();
    const second = mockSocket();
    ioMock.mockReturnValueOnce(first).mockReturnValueOnce(second);

    const client = createIaRealtimeClient("https://ilustre-analytics.org");
    await client.start(() => {});
    expect(ioMock).toHaveBeenCalledTimes(1);

    first.fire("connect_error", new Error("changmen down"));
    await Promise.resolve();
    expect(ioMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(IA_FAILOVER_COOLDOWN_MS);
    await Promise.resolve();
    await Promise.resolve();

    expect(ioMock).toHaveBeenCalledTimes(2);
    expect(ioMock).toHaveBeenLastCalledWith(
      changmenDevBackendOrigin(),
      expect.objectContaining({ path: IA_WS_FORWARD_PATH }),
    );
    expect(ioMock.mock.calls.every(([url]) => url !== IA_OFFICIAL_WS)).toBe(true);

    await client.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});
