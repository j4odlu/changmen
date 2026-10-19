import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  createRayRealtimeClient,
  setRayWsSourceMode,
  type RayRealtimeMessage,
} from "./realtime";
import { RAY_WS_FORWARD_PATH } from "./wsConfig";

const createMock = vi.fn();
const subscribeMock = vi.fn();
const disconnectMock = vi.fn();

vi.mock("socketcluster-client", () => ({
  default: {
    create: (...args: unknown[]) => createMock(...args),
  },
}));

vi.mock("../shared/changmenWsBase", () => ({
  resolveChangmenWsBase: () => "http://127.0.0.1:3560",
}));

function mockSocketCluster(messages: RayRealtimeMessage[] = []) {
  subscribeMock.mockReturnValue({
    listener: () => ({ once: () => Promise.resolve() }),
    [Symbol.asyncIterator]: async function* () {
      for (const msg of messages) yield msg;
    },
  });
  return {
    subscribe: subscribeMock,
    disconnect: disconnectMock,
    state: "closed",
    listener: (event: string) => ({
      [Symbol.asyncIterator]: async function* () {
        if (event === "connect") yield {};
      },
    }),
  };
}

beforeEach(() => {
  createMock.mockReset();
  subscribeMock.mockReset();
  disconnectMock.mockReset();
  setRayWsSourceMode("official");
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("createRayRealtimeClient", () => {
  test("connects directly to cfsocket with A8 collect token", async () => {
    const messages = [{ source: "odds", odds: [{ id: "ray-odd-1", odds: 1.92 }] }];
    createMock.mockReturnValue(mockSocketCluster(messages));

    const received: RayRealtimeMessage[] = [];
    const client = createRayRealtimeClient();
    await client.start((message) => received.push(message));
    await vi.waitFor(() => expect(received.length).toBeGreaterThan(0));

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: "cfsocket.365raylinks.com",
        path: "/socketcluster/",
        secure: true,
        port: 443,
        wsOptions: expect.objectContaining({
          headers: expect.objectContaining({
            Origin: "https://ray164.com",
            Authorization: expect.stringContaining("Bearer "),
          }),
        }),
      }),
    );
    expect(subscribeMock).toHaveBeenCalledWith("match");
    expect(received).toEqual([{ source: "odds", odds: [{ id: "ray-odd-1", odds: 1.92 }] }]);

    await client.stop();
    expect(disconnectMock).toHaveBeenCalledOnce();
  });

  test("falls back to CHANGMEN forward when official connection fails", async () => {
    const officialSocket = {
      subscribe: subscribeMock,
      disconnect: disconnectMock,
      state: "closed",
      listener: (event: string) => ({
        [Symbol.asyncIterator]: async function* () {
          if (event === "error") yield { error: "upstream refused" };
        },
      }),
    };
    const changmenSocket = mockSocketCluster([]);
    createMock.mockReturnValueOnce(officialSocket).mockReturnValueOnce(changmenSocket);

    const client = createRayRealtimeClient();
    await client.start(() => {});

    await vi.waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(2);
    });

    expect(createMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        hostname: "127.0.0.1",
        port: 3560,
        secure: false,
        path: RAY_WS_FORWARD_PATH,
        wsOptions: expect.objectContaining({
          headers: expect.objectContaining({
            Origin: "https://ray164.com",
            Authorization: expect.stringContaining("Bearer "),
          }),
        }),
      }),
    );

    await client.stop();
  });

  test("connects selected CHANGMEN source directly", async () => {
    setRayWsSourceMode("changmen");
    createMock.mockReturnValue(mockSocketCluster([]));

    const client = createRayRealtimeClient();
    await client.start(() => {});

    expect(createMock).toHaveBeenCalledOnce();
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: "127.0.0.1",
        port: 3560,
        path: RAY_WS_FORWARD_PATH,
      }),
    );

    await client.stop();
  });

  test("maps legacy a8 mode to official", async () => {
    setRayWsSourceMode("a8" as never);
    createMock.mockReturnValue(mockSocketCluster([]));

    const client = createRayRealtimeClient();
    await client.start(() => {});

    expect(createMock).toHaveBeenCalledOnce();
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: "cfsocket.365raylinks.com",
        path: "/socketcluster/",
      }),
    );

    await client.stop();
  });

  test("stays on selected CHANGMEN source when connection fails", async () => {
    setRayWsSourceMode("changmen");
    const changmenSocket = {
      subscribe: subscribeMock,
      disconnect: disconnectMock,
      state: "closed",
      listener: (event: string) => ({
        [Symbol.asyncIterator]: async function* () {
          if (event === "error") yield { error: "upstream refused" };
        },
      }),
    };
    createMock.mockReturnValueOnce(changmenSocket);

    const client = createRayRealtimeClient();
    await client.start(() => {});

    await vi.waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));

    await client.stop();
  });
});
