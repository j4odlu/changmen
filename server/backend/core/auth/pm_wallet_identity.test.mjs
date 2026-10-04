import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), accounts: vi.fn(), json: vi.fn() }));
vi.mock("./http_identity.js", () => ({ requireHttpUser: mocks.auth }));
vi.mock("../db/store.js", () => ({ loadAccountsForUserStrict: mocks.accounts }));
vi.mock("../http/body.js", () => ({ jsonResponse: mocks.json }));
vi.mock("@changmen/db", () => ({ authGetUserStatus: vi.fn() }));
import { tryPmWalletIdentity } from "./pm_wallet_identity.js";
const res = { setHeader: vi.fn() };
const req = { url: "/auth/pm-wallet-identity", method: "GET" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "u" }, identity: { loginEpoch: "login-1" } });
  mocks.accounts.mockResolvedValue([]);
});
describe("PM wallet identity endpoint", () => {
  it("returns only verified login identity and PM wallet bindings, never credentials", async () => {
    mocks.accounts.mockResolvedValue([
      { accountId: 1, provider: "Polymarket", token: JSON.stringify({ walletAddress: `0x${"AB".repeat(20)}`, privateKey: "never-return", apiCreds: { secret: "never-return" } }) },
      { accountId: 2, provider: "PredictFun", token: "never-return" },
    ]);
    expect(await tryPmWalletIdentity(req, res)).toBe(true);
    expect(mocks.accounts).toHaveBeenCalledWith("u");
    expect(mocks.json).toHaveBeenCalledWith(res, 200, { userId: "u", loginEpoch: "login-1", accounts: [{ accountId: 1, walletAddress: `0x${"ab".repeat(20)}` }] });
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(JSON.stringify(mocks.json.mock.calls)).not.toContain("never-return");
  });
  it("rejects missing identity and revoked credentials before reading accounts", async () => {
    mocks.auth.mockResolvedValue({ error: { status: 401, body: { code: "SESSION_REVOKED" } } });
    await tryPmWalletIdentity(req, res);
    expect(mocks.json).toHaveBeenCalledWith(res, 401, { code: "SESSION_REVOKED" });
    expect(mocks.accounts).not.toHaveBeenCalled();
  });
  it("account read failures are unavailable, not an empty trusted account list", async () => {
    mocks.accounts.mockRejectedValue(Error("db unavailable"));
    await tryPmWalletIdentity(req, res);
    expect(mocks.json).toHaveBeenCalledWith(res, 503, { code: "TEMPORARY_UNAVAILABLE" });
  });
  it("does not accept writes or override other auth routes", async () => {
    expect(await tryPmWalletIdentity({ ...req, url: "/auth/session" }, res)).toBe(false);
    await tryPmWalletIdentity({ ...req, method: "POST" }, res);
    expect(mocks.json).toHaveBeenCalledWith(res, 405, { code: "METHOD_NOT_ALLOWED" });
    expect(mocks.auth).not.toHaveBeenCalled();
  });
});
