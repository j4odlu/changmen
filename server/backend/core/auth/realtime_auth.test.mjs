import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const savedEnv = { ...process.env };
afterEach(() => { process.env = { ...savedEnv }; });
const mocks = vi.hoisted(() => ({ jwt: vi.fn(), cookie: vi.fn(), profile: vi.fn() }));
vi.mock("@changmen/db", () => ({ authGetUserStatus: mocks.jwt, authResolveBrowserSession: mocks.cookie, authorizeClientCertificate: async () => null }));
vi.mock("../db/store.js", () => ({ loadProfileById: mocks.profile }));
const { authenticateRealtime, authorizeRealtime } = await import("./realtime_auth.js");
function socket(token = "valid") {
  const headers = { origin: "https://changmen.fun" };
  return { handshake: { auth: { token }, headers }, request: { headers }, data: {} };
}
beforeEach(() => {
  process.env.WEB_AUTH_ORIGINS = "https://changmen.fun";
  process.env.NODE_ENV = "test";
  vi.resetAllMocks();
  mocks.jwt.mockResolvedValue({ userId: "user", loginEpoch: "epoch" });
  mocks.profile.mockResolvedValue({ id: "user", role: "user", setting: {} });
});
describe("private realtime identity and channel permissions", () => {
  it("rejects arbitrary nonempty tokens and asks DB for a fresh revocation check", async () => {
    mocks.jwt.mockResolvedValue({ code: "AUTH_REQUIRED" });
    expect(await authenticateRealtime(socket("random-nonempty"))).toEqual({ code: "AUTH_REQUIRED" });
    expect(mocks.jwt).toHaveBeenCalledWith("random-nonempty", { fresh: true });
  });
  it("rejects foreign origins before any credential lookup", async () => {
    const s = socket(); s.request.headers.origin = "https://evil.example";
    expect(await authenticateRealtime(s)).toEqual({ code: "ORIGIN_INVALID" });
    expect(mocks.jwt).not.toHaveBeenCalled();
  });
  it("authenticates same-origin Cookie connections without browser JWT", async () => {
    const s = socket("");
    s.request.headers.cookie = "cm_session=opaque";
    s.handshake.auth.protocol = "cookie";
    mocks.cookie.mockResolvedValue({ userId: "user", jwtSessionId: "epoch" });
    expect(await authenticateRealtime(s)).toHaveProperty("user.id", "user");
    expect(mocks.jwt).not.toHaveBeenCalled();
  });
  it("rejects token/Cookie identity conflict", async () => {
    const s = socket(); s.request.headers.cookie = "cm_session=opaque";
    mocks.cookie.mockResolvedValue({ userId: "different", jwtSessionId: "epoch" });
    expect(await authenticateRealtime(s)).toEqual({ code: "CREDENTIAL_CONFLICT" });
  });
  it("restricts own user room and server-only channels", async () => {
    expect(await authorizeRealtime(socket(), "USER:user", "subscribe")).toBe(true);
    expect(await authorizeRealtime(socket(), "USER:other", "subscribe")).toBe(false);
    expect(await authorizeRealtime(socket(), "USER:other", "publish", '{}')).toBe(false);
    expect(await authorizeRealtime(socket(), "Polymarket:PmSport", "publish", '{}')).toBe(false);
    expect(await authorizeRealtime(socket(), "unregistered-room", "subscribe")).toBe(false);
    expect(await authorizeRealtime(socket(), "Publish", "publish", '{}')).toBe(false);
  });
  it("checks current settings and denies after revocation", async () => {
    mocks.profile.mockResolvedValue({ id: "user", role: "user", setting: { Publisher: true } });
    expect(await authorizeRealtime(socket(), "Publish", "publish", '{}')).toBe(true);
    mocks.jwt.mockResolvedValue({ code: "SESSION_REVOKED" });
    expect(await authorizeRealtime(socket(), "Publish", "publish", '{}')).toBe(false);
  });
});
