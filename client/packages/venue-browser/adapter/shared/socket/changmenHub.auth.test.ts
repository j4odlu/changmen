import { afterEach, describe, expect, it, vi } from "vitest";
import { getChangmenAuthToken, setChangmenAuthTokenGetter, setChangmenHandshakeTokenGetter, setChangmenCookieSessionGetter } from "../changmenAuthToken";
const capture = vi.hoisted(() => { vi.resetModules(); return { options: null as any }; });
vi.mock("socket.io-client", () => ({ io: (_origin: string, options: any) => {
  capture.options = options;
  const listeners = new Map<string, (...args: any[]) => void>();
  const socket = {
    connected: false,
    on(event: string, fn: (...args: any[]) => void) { listeners.set(event, fn); return socket; },
    emit(_event: string, _payload: unknown, ack?: (result: unknown) => void) { ack?.({ ok: true }); },
    removeAllListeners() { listeners.clear(); }, disconnect() { socket.connected = false; },
  };
  queueMicrotask(() => { socket.connected = true; listeners.get("connect")?.(); });
  return socket;
} }));
const { subscribeChangmenChannel } = await import("./changmenHub");
afterEach(() => {
  setChangmenAuthTokenGetter(null); setChangmenHandshakeTokenGetter(null); setChangmenCookieSessionGetter(null);
  vi.useRealTimers();
});
describe("private hub handshake credentials", () => {
  it("reads the refreshed token on every handshake rather than capturing the first token", async () => {
    vi.useFakeTimers();
    let token = "first-access";
    setChangmenAuthTokenGetter(() => token);
    setChangmenHandshakeTokenGetter(async () => token);
    const cleanup = await subscribeChangmenChannel("BetTarget", () => {});
    const first = await new Promise(resolve => capture.options.auth(resolve));
    expect(first).toEqual({ token: "first-access" });
    token = "refreshed-access";
    const second = await new Promise(resolve => capture.options.auth(resolve));
    expect(second).toEqual({ token: "refreshed-access" });
    cleanup();
  });
  it("uses same-origin Cookie protocol without exposing a JWT in the handshake", async () => {
    vi.useFakeTimers();
    setChangmenAuthTokenGetter(() => "");
    setChangmenCookieSessionGetter(() => true);
    const cleanup = await subscribeChangmenChannel("BetTarget", () => {});
    const handshake = vi.fn(); capture.options.auth(handshake);
    expect(handshake).toHaveBeenCalledWith({ protocol: "cookie" });
    cleanup();
  });
  it("does not resurrect a stored legacy credential after the host has logged out", () => {
    localStorage.setItem("app:token", "stale-secret");
    setChangmenAuthTokenGetter(() => "");
    expect(getChangmenAuthToken()).toBe("");
    localStorage.removeItem("app:token");
  });
});
