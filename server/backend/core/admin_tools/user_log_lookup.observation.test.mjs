import { beforeEach, describe, expect, it, vi } from "vitest";
import { lookupOrderLogs, toAdminOrderLogPayload } from "./user_log_lookup.js";
import * as lookupApi from "./user_log_lookup.js";
import { summarizeOrderObservations } from "./order_observation.js";
import { createOriginalLookup } from "./user_log_lookup/__tests__/original.mjs";

const mocks = vi.hoisted(() => ({ observations: vi.fn(), orders: vi.fn(), linkedOrders: vi.fn(), logs: vi.fn(),
  userById: vi.fn(async id => ({ id, user_name: "test" })), userByName: vi.fn(), orderById: vi.fn(), football: vi.fn() }));
vi.mock("@changmen/db", () => ({
  fetchUserById: mocks.userById,
  fetchUserByName: mocks.userByName,
  fetchOrdersByLink: mocks.orders,
  fetchOrdersByLinks: mocks.linkedOrders,
  fetchOrderObservations: mocks.observations,
  fetchOrderByOrderId: mocks.orderById,
  fetchFootballOrderByVenueOrderId: mocks.football,
  fetchBettingUserLogsInRange: mocks.logs,
}));

describe("没有订单的精确执行诊断", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.orders.mockResolvedValue([]);
    mocks.linkedOrders.mockResolvedValue([]);
    mocks.logs.mockResolvedValue({ rows: [], truncated: false, limit: 1000 });
    mocks.observations.mockResolvedValue({ status: "available", truncated: false, events: [
      { kind: "execution_started", executionId: "execution-123", eventId: "event-123", ownerUserId: "u1", sequence: 1, occurredAt: 1000, linkId: 123 },
    ] });
  });
  it("reads exact Link evidence without manufacturing orders or using time-window guesses", async () => {
    const result = await lookupOrderLogs({ userId: "u1", link: 123 });
    expect(result.ok).toBe(true);
    expect(result.orders).toEqual([]);
    expect(mocks.observations).toHaveBeenCalledWith("u1", 123, 2000, [], {});
    expect(mocks.logs).not.toHaveBeenCalled();
    expect(toAdminOrderLogPayload(result).observation.events).toHaveLength(1);
  });
  it("keeps execution lookup scoped to the requested user and ID", async () => {
    const result = await lookupOrderLogs({ userId: "u2", executionId: "execution-123" });
    expect(result.ok).toBe(true);
    expect(mocks.observations).toHaveBeenCalledWith("u2", 0, 2000, [], { executionId: "execution-123" });
    expect(mocks.orders).not.toHaveBeenCalled();
    expect(mocks.logs).not.toHaveBeenCalled();
  });
  it("rejects malformed IDs and fractional Links before querying evidence", async () => {
    expect((await lookupOrderLogs({ userId: "u1", executionId: "' OR 1=1" })).ok).toBe(false);
    expect((await lookupOrderLogs({ userId: "u1", link: 1.5 })).ok).toBe(false);
    expect(mocks.observations).not.toHaveBeenCalled();
  });
  it("reads an exact evidence record without searching legacy logs", async () => {
    const result = await lookupOrderLogs({ userId: "u1", eventId: "event-123" });
    expect(result.ok).toBe(true);
    expect(mocks.observations).toHaveBeenCalledWith("u1", 0, 2000, [], { eventId: "event-123" });
    expect(mocks.orders).not.toHaveBeenCalled();
    expect(mocks.logs).not.toHaveBeenCalled();
  });
  it("does not turn unavailable or missing observations into success", async () => {
    mocks.observations.mockResolvedValue({ status: "unavailable", events: [], truncated: false });
    expect((await lookupOrderLogs({ userId: "u1", link: 123 })).ok).toBe(false);
    mocks.observations.mockResolvedValue({ status: "available", events: [], truncated: false });
    expect((await lookupOrderLogs({ userId: "u1", link: 123 })).ok).toBe(false);
  });
  const order = { order_id: "pm-original", provider: "Polymarket", player_id: 7, link: 123, status: "None", create_at: 1000,
    odds: 1.9, bet_money: 100, money: 0, raw: { pmShares: 10, token: "secret" } };
  const submit = { version: 1, kind: "submission_result", executionId: "execution-123", attemptId: "attempt-123", eventId: "submit-123",
    ownerUserId: "u1", sequence: 1, occurredAt: 1000, linkId: 123, provider: "Polymarket", accountId: 7,
    orderId: "pm-original", observedStatus: "delayed", outcome: "accepted", source: "adapter_result" };
  it("the ordinary diagnostic button can read direct decisions and current orders without scanning old logs", async () => {
    mocks.orders.mockResolvedValue([order]);
    mocks.observations.mockResolvedValue({ status: "available", events: [submit], truncated: false });
    const payload = toAdminOrderLogPayload(await lookupOrderLogs({ userId: "u1", link: 123, preferDirect: true }));
    expect(payload).toMatchObject({ diagnosticSource: "events", legacyLogsLoaded: false, ordersQueried: true });
    expect(payload.observation.attempts[0].confirmation.label).toBe("订单已成交 · 未结算");
    expect(payload.orders).toHaveLength(1);
    expect(JSON.stringify(payload)).not.toContain("secret");
    expect(mocks.logs).not.toHaveBeenCalled();
  });
  it.each(["unavailable", "empty", "gap-only"])("falls back to the existing diagnostic logs when observations are %s", async status => {
    mocks.orders.mockResolvedValue([order]);
    mocks.observations.mockResolvedValue({ status: status === "unavailable" ? status : "available",
      events: status === "gap-only" ? [{ ...submit, kind: "transport_gap" }] : [], truncated: false });
    const payload = await lookupOrderLogs({ userId: "u1", link: 123, preferDirect: true });
    expect(payload).toMatchObject({ ok: true, diagnosticSource: "legacy", legacyLogsLoaded: true });
    expect(mocks.logs).toHaveBeenCalledOnce();
    if (status === "gap-only") expect(payload.observation.issues).toContain("客户端报告观察事件丢失");
  });
  it("allows old logs to be requested explicitly without replacing the direct records", async () => {
    mocks.orders.mockResolvedValue([order]);
    mocks.observations.mockResolvedValue({ status: "available", events: [submit], truncated: false });
    const result = await lookupOrderLogs({ userId: "u1", link: 123, preferDirect: false });
    expect(result.legacyLogsLoaded).toBe(true);
    expect(result.observation.attempts[0].confirmation.label).toBe("订单已成交 · 未结算");
    expect(mocks.logs).toHaveBeenCalledOnce();
  });
  it("exact execution queries load current orders in one user-scoped batch and reject other account identities", async () => {
    mocks.observations.mockResolvedValue({ status: "available", events: [submit], truncated: true });
    mocks.linkedOrders.mockResolvedValue([order, { ...order, player_id: 8 }, { ...order, provider: "RAY" }, { ...order, link: 999 }]);
    const result = await lookupOrderLogs({ userId: "u1", executionId: "execution-123", preferDirect: true });
    expect(mocks.linkedOrders).toHaveBeenCalledWith("u1", [123]);
    expect(result.orders).toHaveLength(1);
    expect(result.observation.truncated).toBe(true);
    expect(result.observation.attempts[0].confirmation.label).toBe("订单已成交 · 未结算");
    expect(mocks.logs).not.toHaveBeenCalled();
  });
});

// Run the complete pre-refactor implementation against the same isolated DB ports.
const dbPorts = {
  fetchUserById: mocks.userById, fetchUserByName: mocks.userByName,
  fetchOrdersByLink: mocks.orders, fetchOrdersByLinks: mocks.linkedOrders,
  fetchOrderByOrderId: mocks.orderById, fetchFootballOrderByVenueOrderId: mocks.football,
  fetchOrderObservations: mocks.observations, fetchBettingUserLogsInRange: mocks.logs,
};
const originalLookup = createOriginalLookup({ ...dbPorts, summarizeOrderObservations });
const stamp = 1_790_000_000_000;
const clone = value => structuredClone(value);
function orderFixture(provider = "Polymarket", index = 0) {
  return { order_id: `order-${index}`, provider, player_id: 7 + index, link: stamp, match: "A vs B", bet: "Winner", item: index ? "Away" : "Home",
    odds: 2.05, bet_money: 10.25, money: index ? -5.5 : 12.5, status: index ? "Reject" : "Pending", create_at: stamp + index * 100,
    raw: { token: "synthetic-sensitive-value", pmShares: 10, pmSide: index ? "sell" : "buy", PfSide: index ? "SELL" : "BUY",
      pmSellProceeds: 2.5, pfSellProceeds: 1.5, positionEvents: { sells: [{ id: "sell-one", shares: 2, price: 0.5, pnl: -0.1, proceeds: 1,
        at: stamp, origin: "external", status: "filled", token: "synthetic-sensitive-value" }, null, { id: "" }] } } };
}
function eventFixture(provider = "Polymarket", changes = {}) {
  return { version: 1, ownerUserId: "owner-one", eventId: "event-one", kind: "submission_result", occurredAt: stamp,
    sequence: 1, linkId: stamp, executionId: "execution-one", attemptId: "attempt-one", provider, accountId: 7,
    orderId: "order-0", outcome: "accepted", observedStatus: "delayed", source: "adapter_result", ...changes };
}
function scenarioFixture(provider = "Polymarket", source = "direct", truncated = false) {
  const raw = data => JSON.stringify(data);
  const head = orderFixture(provider);
  return {
    orders: [orderFixture("RAY", 1), head],
    candidates: [head, { ...head, player_id: 999 }, { ...head, provider: provider === "OB" ? "Polymarket" : "OB" }, { ...head, link: 444 }],
    byId: head,
    observation: { status: source === "unavailable" ? "unavailable" : "available", truncated,
      events: source === "legacy" || source === "unavailable" ? [] : [eventFixture(provider, source === "gap-only" ? { kind: "transport_gap" } : {})] },
    logQuery: { truncated, limit: truncated ? 3 : 1000, rows: [
      { id: 1, create_at: stamp - 100, title: `[${provider}](platform, player) 请求盘口数据 => true`,
        data: raw({ options: { type: provider, target: "Home", linkId: stamp, match: "A vs B", bet: "Winner", odds: 2.05, betMoney: 10.25 }, data: { "b[0]": "oid=oid-one&odd=2.05&a=10.25" }, token: "synthetic-sensitive-value" }) },
      { id: 2, create_at: stamp, title: `[${provider}](platform, player) 下注 => true`, data: raw({ result: {
        provider, success: true, orderId: "order-0", link: stamp, message: "accepted", request: { "b[0]": "oid=oid-one&odd=2.05&a=10.25" }, token: "synthetic-sensitive-value" } }) },
      { id: 3, create_at: stamp + 100, title: `[${provider}](platform, player) order-0 拒单`, data: raw({ linkId: stamp, orderId: "order-0", diagnosticVersion: 1, settlement: "timeout", target: "Home", observedAt: stamp + 100, rejectDelayMs: 100 }) },
      { id: 4, create_at: stamp + 110, title: "补单入队", data: raw({ linkId: stamp, target: "Away", betMoney: 10, odds: 2, failedPlatformLabel: "RAY" }) },
      { id: 5, create_at: stamp + 120, title: "补单取消", data: raw({ linkId: stamp, target: "Away", reason: "anchor rejected" }) },
      { id: 6, create_at: stamp, title: "[OB](other, player) 请求盘口数据 => true", data: raw({ options: { type: "OB", target: "Away", linkId: stamp + 1, match: "A vs B", bet: "Winner" } }) },
      { id: 7, create_at: stamp, title: "unrelated diagnostic", data: "broken JSON {" },
    ] },
  };
}
function configurePorts(scenario = {}, failAt) {
  const trace = [];
  const implementations = {
    fetchUserById: id => scenario.user === undefined ? { id, user_name: "user" } : scenario.user,
    fetchUserByName: user_name => scenario.user === undefined ? { id: "named-owner", user_name } : scenario.user,
    fetchOrdersByLink: () => scenario.orders ?? [], fetchOrdersByLinks: () => scenario.candidates ?? [],
    fetchOrderByOrderId: () => scenario.byId ?? null, fetchFootballOrderByVenueOrderId: () => scenario.football ?? null,
    fetchOrderObservations: () => scenario.observation ?? { status: "available", events: [], truncated: false },
    fetchBettingUserLogsInRange: () => scenario.logQuery ?? { rows: [], truncated: false, limit: 1000 },
  };
  for (const [name, mock] of Object.entries(dbPorts)) mock.mockReset().mockImplementation(async (...args) => {
    trace.push([name, clone(args)]);
    if (name === failAt) throw new Error(`synthetic ${name} failure`);
    return clone(implementations[name](...args));
  });
  return trace;
}
async function runLookup(api, options, scenario, failAt) {
  const trace = configurePorts(scenario, failAt);
  try {
    const result = await api.lookupOrderLogs(options);
    const payload = api.toAdminOrderLogPayload(result), report = api.formatLookupReport(result);
    return { result, payload, report, trace };
  } catch (error) { return { error: { name: error.name, message: error.message }, trace }; }
}
async function compareLookup(options, scenario, failAt) {
  const before = await runLookup(originalLookup, options, scenario, failAt);
  const after = await runLookup(lookupApi, options, scenario, failAt);
  expect(after).toEqual(before);
  return after;
}

describe("complete backend lookup compatibility", () => {
  const cases = [];
  for (const provider of ["OB", "Polymarket", "PredictFun"]) for (const source of ["legacy", "direct", "unavailable", "gap-only"])
    for (const preferDirect of [false, true]) for (const kind of ["link", "order", "execution", "attempt", "event"])
      for (const truncated of [false, true]) cases.push([provider, source, preferDirect, kind, truncated]);
  it.each(cases)("matches complete original response and query trace: %s %s direct=%s %s truncated=%s", async (provider, source, preferDirect, kind, truncated) => {
    const selector = { link: { link: stamp }, order: { orderId: "order-0" }, execution: { executionId: "execution-one" }, attempt: { attemptId: "attempt-one" }, event: { eventId: "event-one" } }[kind];
    const result = await compareLookup({ userId: "owner-one", preferDirect, ...selector }, scenarioFixture(provider, source, truncated));
    expect(result.trace[0]).toEqual(["fetchUserById", ["owner-one"]]);
    expect(result.trace.every(([, args]) => args[0] === "owner-one")).toBe(true);
    if (["execution", "attempt", "event"].includes(kind)) expect(result.trace.some(([name]) => name === "fetchBettingUserLogsInRange")).toBe(false);
    if (result.payload?.ok) expect(JSON.stringify(result.payload)).not.toContain("synthetic-sensitive-value");
    if (kind === "event" && preferDirect && source === "direct") expect(result.payload.orders).toHaveLength(1);
  });

  it.each([
    undefined, {}, { userId: "  " }, { userName: " " }, { userId: "u" }, { userId: "u", link: 0 },
    ...[1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, "invalid", "0"].map(link => ({ userId: "u", link })),
    ...["short", "x".repeat(161), "bad identifier", "' OR 1=1"].map(executionId => ({ userId: "u", executionId })),
    { userId: "u", executionId: "valid-execution", eventId: "bad" },
    { userId: "u", executionId: "valid-execution", attemptId: "bad" },
  ])("preserves validation and selector precedence: %j", async options => {
    await compareLookup(options, scenarioFixture());
  });

  it.each([
    [{ userId: "missing", link: stamp }, { user: null }],
    [{ userName: "missing", orderId: "order-0" }, { user: {} }],
    [{ userName: "  named user  ", link: stamp }, {}],
    [{ userId: "  owner-one  ", userName: "ignored", link: -stamp }, {}],
    [{ userId: "owner-one", orderId: "missing" }, { byId: null }],
    [{ userId: "owner-one", link: stamp }, { orders: [] }],
    [{ userId: "owner-one", link: stamp, preferDirect: "true" }, {}],
    [{ userId: "owner-one", orderId: "order-0", paddingMs: Number.MAX_SAFE_INTEGER, logLimit: 5000 }, {}],
    [{ userId: "owner-one", link: 1 }, { orders: [{ ...orderFixture(), link: 1, create_at: 0 }] }],
    [{ userId: "owner-one", orderId: "order-0" }, { byId: { ...orderFixture(), link: 0 } }],
  ])("preserves user lookup, missing rows, expansion and preference semantics: %j", async (options, overrides) => {
    await compareLookup(options, { ...scenarioFixture(), ...overrides });
  });

  it.each(["OB", "RAY"])("keeps the football fallback projection for %s", async venue => {
    const scenario = scenarioFixture("OB", "legacy"); scenario.byId = null;
    scenario.football = { venue_order_id: "sport-one", venue, player_id: 9, home: "Home", away: "Away", market_label: "Totals",
      side_label: "Over", odds: 1.95, stake: 30, profit: -30, status: "Lose", placed_at: stamp, client_id: "client-one" };
    const result = await compareLookup({ userId: "owner-one", orderId: "sport-one", domain: "SPORTS", sport: "FOOTBALL", venue }, scenario);
    expect(result.trace).toContainEqual(["fetchFootballOrderByVenueOrderId", ["owner-one", "sport-one", venue]]);
    expect(result.payload.orders[0].match).toBe("Home vs Away");
  });

  it.each(Object.keys(dbPorts))("preserves read failure propagation at %s", async failAt => {
    const options = { userId: "owner-one", link: stamp, preferDirect: false };
    const scenario = scenarioFixture();
    if (failAt === "fetchUserByName") { delete options.userId; options.userName = "user"; }
    if (failAt === "fetchOrderByOrderId" || failAt === "fetchFootballOrderByVenueOrderId") {
      delete options.link; options.orderId = "order-0";
      if (failAt === "fetchFootballOrderByVenueOrderId") { scenario.byId = null; options.domain = "sports"; options.sport = "football"; }
    }
    if (failAt === "fetchOrdersByLinks") { delete options.link; options.executionId = "execution-one"; options.preferDirect = true; }
    const result = await compareLookup(options, scenario, failAt);
    expect(result.error.message).toContain(failAt);
    expect(result.trace.at(-1)[0]).toBe(failAt);
  });

  it("keeps user, order and observation reads sequential before scanning legacy logs", async () => {
    async function exercise(api) {
      const trace = configurePorts(scenarioFixture());
      const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
      const user = deferred(), orders = deferred(), observations = deferred();
      mocks.userById.mockImplementation(id => { trace.push(["fetchUserById", [id]]); return user.promise; });
      mocks.orders.mockImplementation((...args) => { trace.push(["fetchOrdersByLink", args]); return orders.promise; });
      mocks.observations.mockImplementation((...args) => { trace.push(["fetchOrderObservations", args]); return observations.promise; });
      const pending = api.lookupOrderLogs({ userId: "owner-one", link: stamp });
      const steps = [clone(trace)];
      const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
      user.resolve({ id: "owner-one", user_name: "user" }); await flush(); steps.push(clone(trace));
      orders.resolve([orderFixture()]); await flush(); steps.push(clone(trace));
      observations.resolve({ status: "available", events: [], truncated: false });
      const result = await pending; steps.push(clone(trace));
      return { steps, result: api.toAdminOrderLogPayload(result) };
    }
    const before = await exercise(originalLookup), after = await exercise(lookupApi);
    expect(after).toEqual(before);
    expect(after.steps.map(trace => trace.length)).toEqual([1, 2, 3, 4]);
  });
});
