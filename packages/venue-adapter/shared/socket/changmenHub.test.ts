import { afterEach, expect, it, vi } from "vitest";
import { setChangmenAuthTokenGetter } from "../changmenAuthToken";

const mocks = vi.hoisted(() => {
  vi.resetModules();
  return { io: vi.fn() };
});
vi.mock("socket.io-client", () => ({ io: mocks.io }));

afterEach(() => {
  setChangmenAuthTokenGetter(null);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("subscribes with an in-memory cookie-session token and configured API origin", async () => {
  vi.useFakeTimers();
  // Cookie 登录不把 access token 写入 localStorage。
  vi.stubGlobal("localStorage", { getItem: () => null });
  vi.stubGlobal("window", { location: { origin: "https://changmen.fun" } });
  vi.stubEnv("VITE_API_BASE", "https://api.changmen.fun/");
  setChangmenAuthTokenGetter(() => "memory-session-token");
  const listeners = new Map<string, (...args: any[]) => void>();
  const socket = {
    connected: false,
    on: vi.fn((event, handler) => listeners.set(event, handler)),
    emit: vi.fn((_event, _payload, ack) => ack?.({ ok: true })),
    removeAllListeners: vi.fn(),
    disconnect: vi.fn(),
  };
  mocks.io.mockReturnValue(socket);
  const { subscribeChangmenChannel, PM_MAINTENANCE_CHANNEL } = await import("./changmenHub");
  const handler = vi.fn();
  const subscribing = subscribeChangmenChannel(PM_MAINTENANCE_CHANNEL, handler);
  expect(mocks.io).toHaveBeenCalledWith("https://api.changmen.fun", expect.objectContaining({
    auth: { token: "memory-session-token" },
  }));
  socket.connected = true;
  listeners.get("connect")?.();
  const unsubscribe = await subscribing;
  listeners.get("pubsub:message")?.({
    channel: PM_MAINTENANCE_CHANNEL,
    content: { state: "operational" },
  });
  expect(handler).toHaveBeenCalledWith({ state: "operational" });
  unsubscribe();
});
