import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import legacyVenueGames from "@changmen/shared/catalog/venue_games.json" with { type: "json" };

// [changmen 扩展] Fixed consumer examples. Exercise the real HTTP parser, router,
// account dispatcher and login use case; stub persistence and external services.
const h = vi.hoisted(() => {
  const account = { accountId: 17, provider: "OB", token: "synthetic+token", gateway: "https://venue.invalid", balance: 12.5 };
  return {
    account, user: { id: "contract-user", userName: "contract" }, authenticated: true,
    db: { authRefreshToken: vi.fn(), authBrowserSession: vi.fn(), authResolveBrowserSession: vi.fn(),
      authGetUserStatus: vi.fn(), authorizeClientCertificate: vi.fn(), recordAuthAudit: vi.fn(),
      isAuthConfigured: () => true, certificateRegistryEnabled: () => false, authSignIn: vi.fn() },
    cache: { getProfileById: vi.fn(), loadProfileById: vi.fn(), loadAccountsForUser: vi.fn(), refreshAccountsFromRdsIfEmpty: vi.fn() },
    service: { handleGetData: vi.fn(), handleSaveData: vi.fn(), handleSaveAccounts: vi.fn(), handleSaveOrderBind: vi.fn() },
    orders: { getOrders: vi.fn(), saveOrders: vi.fn() },
    store: { ensureSeed: vi.fn(), buildMatchList: vi.fn(), saveMatches: vi.fn(), saveBets: vi.fn(), saveLiveTimer: vi.fn(), getPlatform: vi.fn() },
    catalog: { games: [] }, originalGames: [],
    touch: vi.fn(), recordLogin: vi.fn(), cookie: false,
  };
});
vi.mock("@changmen/shared/catalog/game_catalog.json", async importOriginal => {
  const original = await importOriginal();
  h.originalGames = structuredClone(original.default.games);
  Object.assign(h.catalog, original.default, { games: structuredClone(h.originalGames) });
  return { default: h.catalog };
});
vi.mock("@changmen/db", () => h.db);
vi.mock("@changmen/ws-forward", () => ({ isWsForwardHttpPath: () => false }));
vi.mock("../db/store.js", () => h.cache);
vi.mock("./store.js", () => ({ default: h.store }));
vi.mock("../account/account_store.js", () => ({ ensureSeed: vi.fn() }));
vi.mock("../account/account_service.js", () => h.service);
vi.mock("../account/admin_service.js", () => ({ assertProfileActive: vi.fn() }));
vi.mock("../account/report_service.js", () => ({ getMonthReport: vi.fn() }));
vi.mock("../orderModes/router.js", () => h.orders);
vi.mock("../account/user_presence.js", () => ({ touchUserPresence: h.touch }));
vi.mock("../account/user_login_meta.js", () => ({ normalizeClientIp: value => value, recordUserLastLogin: h.recordLogin }));
vi.mock("../auth/request_auth.js", () => ({
  resolveRequestAuth: async ({ token, action }) => h.authenticated || action === "Client_RefreshToken"
    ? { token, user: h.user } : { failure: { success: 0, code: "AUTH_REQUIRED", msg: "未登录", info: null } },
  shouldAuditAccessFailure: () => false, authFailure: code => ({ success: 0, code, msg: "未登录", info: null }),
}));
vi.mock("../auth/browser_session.js", () => ({ browserSessionEnabled: () => h.cookie,
  readBrowserSessionCookie: () => h.cookie ? "synthetic-cookie" : "",
  setBrowserSessionCookie: (res, token) => res.setHeader("Set-Cookie", token),
}));
vi.mock("../auth/web_session_security.js", () => ({ validAuthOrigin: () => true, validSessionCsrf: () => true }));
vi.mock("../auth/login_rate_limit.js", () => ({ checkLoginRateLimit: () => ({ limited: false }), recordLoginFailure: vi.fn(), recordLoginSuccess: vi.fn() }));
vi.mock("../shared/client_cert_gate.js", () => ({ readClientCertStatus: () => null, clientCertificateAudit: () => ({}),
  clientCertCnFromSubject: () => "", certLoginBindError: () => null }));
vi.mock("../shared/adapter_paths.js", () => ({ requirePlatform: vi.fn() }));
vi.mock("../shared/esport_request_timing.js", () => ({ recordEsportRequest: vi.fn() }));
vi.mock("../integrations/a8/config.js", () => ({ resolveA8Credentials: () => ({}) }));
vi.mock("./admin_routes.js", () => ({ isAdminAction: () => false, handleAdminAction: vi.fn() }));
vi.mock("./football_order_routes.js", () => ({ isFootballOrderAction: () => false, handleFootballOrderAction: vi.fn() }));
vi.mock("./pm_pf_routes.js", () => ({ isPmPfAction: () => false, handlePmPfAction: vi.fn() }));
vi.mock("./hg_follow.js", () => ({ handleCommonApi: vi.fn() }));
vi.mock("./market_hub_route.js", () => ({ resolveMarketHubOriginForUser: () => "" }));
vi.mock("./telegram_send.js", () => ({ handleSendMessage: vi.fn() }));
vi.mock("../admin_tools/client_mirror_notify.js", () => ({ handleClientNotifyAdminTelegram: vi.fn() }));
vi.mock("./v4_router.js", () => ({ handleV4Request: vi.fn() }));
import { handleEsportRequest } from "./router.ts";

const ok = info => ({ success: 1, msg: "ok", info });
const failure = msg => ({ success: 0, msg, info: null });
async function request(action, body = {}, { json = false, raw } = {}) {
  const encoded = raw ?? (json ? JSON.stringify(body) : new URLSearchParams(body).toString());
  const req = Readable.from([Buffer.from(encoded)]);
  Object.assign(req, { method: "POST", url: `/esport/${action}`, socket: { remoteAddress: "127.0.0.1" },
    headers: { "content-type": json ? "application/json" : "application/x-www-form-urlencoded;", token: "synthetic" } });
  const res = { headers: {}, headersSent: false, setHeader(key, value) { this.headers[key] = value; },
    writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); this.headersSent = true; },
    end(value) { this.body = JSON.parse(value); } };
  await handleEsportRequest(req, res, req.url);
  expect(res.status).toBe(200);
  expect(res.headers["Content-Type"]).toBe("application/json; charset=utf-8");
  return res;
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("AUTH_MODE", "dual");
  h.authenticated = true; h.cookie = false;
  h.catalog.games.splice(0, h.catalog.games.length, ...structuredClone(h.originalGames));
  h.cache.loadProfileById.mockResolvedValue(h.user);
  h.cache.refreshAccountsFromRdsIfEmpty.mockResolvedValue([h.account]);
  h.service.handleGetData.mockReturnValue({ direct: [h.account] });
  h.service.handleSaveData.mockResolvedValue({ ok: true, info: true });
  h.service.handleSaveAccounts.mockResolvedValue({ ok: true, info: true });
  h.service.handleSaveOrderBind.mockResolvedValue({ ok: true, info: true });
  h.store.buildMatchList.mockResolvedValue([]);
  h.db.authSignIn.mockResolvedValue({ userId: h.user.id, email: "contract@example.invalid", accessToken: "jwt", refreshToken: "refresh" });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe.each(["legacy", "registry"])("core HTTP consumer contracts (%s dispatch)", mode => {
  beforeEach(() => vi.stubEnv("ESPORT_ACTION_DISPATCH", mode));
  it("preserves every venue's existing game IDs and order from the central catalog", async () => {
    for (const [provider, ids] of Object.entries(legacyVenueGames.providers)) {
      const response = (await request("Client_GetGames", { provider })).body;
      expect(response.success).toBe(1);
      // The snapshot proves compatibility of the original IDs; additional games
      // in the current catalog must never require updating this old snapshot.
      expect(response.info.filter(id => ids.includes(id))).toEqual(ids);
    }
    expect((await request("Client_GetGames", { provider: "unknown-fixture" })).body).toEqual(ok([]));
  });
  it("reflects added, edited and removed catalog games without a venue snapshot update", async () => {
    const before = {};
    for (const provider of ["RAY", "Polymarket"])
      before[provider] = (await request("Client_GetGames", { provider })).body.info;
    const configured = { code: "fixture-game", sport: "esport", name: "测试类目", nameEn: "Fixture",
      platforms: { RAY: "fixture-ray", Polymarket: "fixture-pm" } };
    h.catalog.games.push(configured);
    for (const provider of ["RAY", "Polymarket"]) {
      expect((await request("Client_GetGames", { provider })).body)
        .toEqual(ok([...before[provider], configured.platforms[provider]]));
    }
    configured.platforms.RAY = "fixture-ray-edited";
    expect((await request("Client_GetGames", { provider: "RAY" })).body.info)
      .toEqual([...before.RAY, "fixture-ray-edited"]);
    h.catalog.games.pop();
    expect((await request("Client_GetGames", { provider: "RAY" })).body).toEqual(ok(before.RAY));
  });
  it("keeps sport filtering, duplicate IDs and platform additions compatible", async () => {
    const before = (await request("Client_GetGames", { provider: "RAY" })).body.info;
    h.catalog.games.push(
      { code: "fixture-sport", sport: "basketball", platforms: { RAY: "fixture-sport" } },
      { code: "fixture-default", platforms: { RAY: "fixture-default" } },
      { code: "fixture-duplicate", sport: "esport", platforms: { RAY: legacyVenueGames.providers.RAY[0] } },
    );
    h.store.getPlatform.mockReturnValue({ games: [legacyVenueGames.providers.RAY[0], "fixture-extra", "fixture-extra"] });
    expect((await request("Client_GetGames", { provider: "RAY" })).body)
      .toEqual(ok([...before, "fixture-default", "fixture-extra"]));
  });
  it("keeps ACCOUNT raw JSON arrays distinct from GetAccounts envelopes", async () => {
    expect((await request("Client_GetData", { key: "ACCOUNT" }, { json: true })).body).toEqual([h.account]);
    expect(h.cache.loadAccountsForUser).toHaveBeenCalledWith("contract-user");
    expect(h.cache.loadAccountsForUser.mock.invocationCallOrder[0]).toBeLessThan(h.service.handleGetData.mock.invocationCallOrder[0]);
    expect((await request("Client_GetAccounts")).body).toEqual(ok([h.account]));
  });
  it("preserves lower-case key/content and encoded JSON including plus and ampersand", async () => {
    const content = JSON.stringify([{ ...h.account, token: "a+b&c=中文" }]);
    expect((await request("Client_SaveData", { key: "ACCOUNT", content })).body).toEqual(ok(true));
    expect(h.service.handleSaveData).toHaveBeenCalledExactlyOnceWith("ACCOUNT", content, "contract-user");
    expect((await request("Client_SaveData", { Key: "ACCOUNT", Value: content })).body).toEqual(failure("key required"));
  });
  it.each(["拒绝空覆盖", "账号不属于当前用户", "数据库保存失败"])("preserves ACCOUNT failure: %s", async msg => {
    h.service.handleSaveData.mockResolvedValue({ ok: false, msg });
    expect((await request("Client_SaveData", { key: "ACCOUNT", content: "[]" })).body).toEqual(failure(msg));
    h.service.handleSaveAccounts.mockResolvedValue({ ok: false, msg });
    expect((await request("Client_SaveAccounts", { accounts: "[]" })).body).toEqual(failure(msg));
    expect(h.service.handleSaveAccounts).toHaveBeenCalledWith([], "contract-user");
  });
  it("parses SaveAccounts JSON and rejects malformed input before the service", async () => {
    expect((await request("Client_SaveAccounts", { accounts: JSON.stringify([h.account]) })).body).toEqual(ok(true));
    expect(h.service.handleSaveAccounts).toHaveBeenCalledExactlyOnceWith([h.account], "contract-user");
    expect((await request("Client_SaveAccounts", { accounts: "{" })).body).toEqual(failure("accounts JSON ??"));
    expect(h.service.handleSaveAccounts).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["API_SaveMatch", "matchs", "saveMatches", "invalid matchs json"],
    ["API_SaveBet", "bets", "saveBets", "invalid bets json"],
    ["API_SaveLiveTimer", "timer", "saveLiveTimer", "invalid timer json"],
  ])("decodes and validates %s without changing the provider payload", async (action, field, method, error) => {
    const rows = [{ ID: "a+b&中文", extension: { round: 2 } }];
    expect((await request(`${action}?OB`, { provider: "OB", matchId: "42", [field]: JSON.stringify(rows) })).body).toEqual(ok(true));
    expect(h.store[method]).toHaveBeenCalledExactlyOnceWith(...(field === "bets" ? ["OB", "42", rows] : ["OB", rows]));
    expect((await request(action, { provider: "OB", matchId: "42", [field]: "{" })).body).toEqual(failure(error));
    expect((await request(action, { [field]: "[]" })).body.success).toBe(0);
    expect(h.store[method]).toHaveBeenCalledTimes(1);
  });
  it("keeps the timer response pending until persistence resolves", async () => {
    let release; h.store.saveLiveTimer.mockReturnValue(new Promise(resolve => { release = resolve; }));
    let finished = false;
    const pending = request("API_SaveLiveTimer", { provider: "OB", timer: "[]" }).then(res => { finished = true; return res; });
    try { await vi.waitFor(() => expect(h.store.saveLiveTimer).toHaveBeenCalled()); expect(finished).toBe(false); }
    finally { release(); }
    expect((await pending).body).toEqual(ok(true));
  });
  it("preserves empty matches and optional source fields without coercion", async () => {
    expect((await request("Client_GetMatchs")).body).toEqual(ok([]));
    const rows = [{ ID: 42, Title: "A vs B", Game: "Dota 2", GameID: 2, StartTime: 1700000000,
      Matchs: { OB: "ob-42" }, Bets: [{ ID: 7, MatchID: 42, Map: 0, Sources: {
        PredictFun: { Type: "PredictFun", BetID: "b", HomeID: "h", AwayID: "a", HomeOdds: 1.5, AwayOdds: 2.5,
          HomeMarketID: "111", AwayMarketID: "222" }, OB: { LineID: 123 },
      } }], PmSport: { live: true, currentMap: 1 } }];
    h.store.buildMatchList.mockResolvedValue(rows);
    expect((await request("Client_GetMatchs")).body).toEqual(ok(rows));
  });
  it("keeps outbound warnings non-blocking", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const rows = [{ ID: "legacy-id", Bets: [{ Sources: { PredictFun: { Type: "PredictFun" } } }] }];
    h.store.buildMatchList.mockResolvedValue(rows);
    expect((await request("Client_GetMatchs")).body).toEqual(ok(rows));
  });
  it("preserves order pagination, request strings and error envelopes", async () => {
    const page = { list: [{ OrderID: 12, Status: "Pending", BetMoney: 10 }], total: 1, pageIndex: 1, pageSize: 20 };
    h.orders.getOrders.mockResolvedValue({ ok: true, info: page });
    expect((await request("Client_GetOrderList", { pageIndex: "1", pageSize: "20" })).body).toEqual(ok(page));
    expect(h.orders.getOrders).toHaveBeenCalledExactlyOnceWith({ pageIndex: "1", pageSize: "20" }, "contract-user");
    h.orders.getOrders.mockResolvedValue({ ok: false, msg: "读取失败" });
    expect((await request("Client_GetOrderList")).body).toEqual(failure("读取失败"));
  });
  it("waits for order save confirmation and forwards bind failures", async () => {
    let release; h.orders.saveOrders.mockReturnValue(new Promise(resolve => { release = resolve; }));
    const body = { type: "OB", playerId: "17", orders: '[{"orderId":"order+1"}]' };
    let finished = false;
    const pending = request("Client_SaveOrder", body).then(res => { finished = true; return res; });
    try { await vi.waitFor(() => expect(h.orders.saveOrders).toHaveBeenCalledExactlyOnceWith(body, "contract-user")); expect(finished).toBe(false); }
    finally { release({ ok: false, msg: "落库失败" }); }
    expect((await pending).body).toEqual(failure("落库失败"));
    h.service.handleSaveOrderBind.mockResolvedValue({ ok: false, msg: "绑定失败" });
    expect((await request("Client_SaveOrderBind", { orders: "[]" })).body).toEqual(failure("绑定失败"));
  });
  it("rejects unauthenticated writes before business dispatch", async () => {
    h.authenticated = false;
    expect((await request("Client_SaveOrder")).body).toEqual({ success: 0, code: "AUTH_REQUIRED", msg: "未登录", info: null });
    expect(h.orders.saveOrders).not.toHaveBeenCalled();
  });
  it("keeps legacy and cookie login responses distinct and records activity once", async () => {
    expect((await request("Client_Login", { username: "contract", password: "synthetic" })).body)
      .toEqual(ok({ token: "jwt", refreshToken: "refresh", sessionMode: "legacy", userName: "contract", ID: "contract-user" }));
    expect(h.touch).toHaveBeenCalledExactlyOnceWith("contract-user");
    expect(h.recordLogin).toHaveBeenCalledExactlyOnceWith("contract-user", "127.0.0.1");
    h.cookie = true;
    h.db.authSignIn.mockResolvedValue({ userId: "contract-user", email: "contract@example.invalid", accessToken: "jwt",
      browserAccessToken: "browser-jwt", browserSession: { token: "cookie", absoluteExpiresAt: 1800000000000 } });
    const res = await request("Client_Login", { userName: "contract", password: "synthetic" });
    expect(res.body).toEqual(ok({ token: "browser-jwt", sessionMode: "cookie", userName: "contract", ID: "contract-user" }));
    expect(res.headers["Set-Cookie"]).toBe("cookie");
  });
  it("keeps login validation and refresh failure codes", async () => {
    expect((await request("Client_Login")).body).toEqual(failure("用户名或密码不能为空"));
    expect(h.db.authSignIn).not.toHaveBeenCalled();
    h.db.authRefreshToken.mockResolvedValue({ revoked: true });
    expect((await request("Client_RefreshToken", { refresh_token: "old" })).body)
      .toEqual({ success: 0, code: "SESSION_REVOKED", msg: "会话已失效，请重新登录", info: null });
    expect(h.db.authRefreshToken).toHaveBeenCalledWith("old", expect.any(Object));
    h.db.authRefreshToken.mockResolvedValue({ userId: "contract-user", accessToken: "next", refreshToken: "next-refresh" });
    expect((await request("Client_RefreshToken", { refreshToken: "old" })).body)
      .toEqual(ok({ token: "next", refreshToken: "next-refresh", sessionMode: "legacy" }));
  });
});
