import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {BetOption} from "@changmen/client-core/models/betOption";
import {PlatformAccount} from "@changmen/client-core/models/platformAccount";
import {ViewBetItem} from "@changmen/client-core/models/match";
import {clearOddsAccess, registerOddsAccess} from "@changmen/client-core/bridge/oddsAccess";
import {accountHttpRequest, clearPlatformHttpContext, registerPlatformHttpContext} from "@changmen/client-core/shared/platformHttp";
import {rayProvider} from "./bet";
import {accountPostForm} from "./accountHttp";

const http = vi.hoisted(() => ({request: vi.fn()}));
vi.mock("@changmen/client-core/shared/a8Axios", () => ({
  a8Axios: {request: http.request}, responseBodyText: (value: unknown) => typeof value === "string" ? value : JSON.stringify(value),
}));
vi.mock("@changmen/venue-browser/shared/webBridge", () => ({useMessageStore: () => ({limitMessage: () => "limit"})}));

const fixture = JSON.parse(readFileSync(new URL("./fixtures/a8RayExecution.json", import.meta.url), "utf8")) as {
  sourceSha256: string; fragments: Record<string, {text: string; sha256: string; start: number; end: number}>;
};
const pins = {
  rayProvider: "d22fa7ef72c7d8046ab8f1f3c417cd4a43cf483ce03d8bb66ec5059c90b2b620",
  betOption: "ceae48e426aa121271b688be3d82db20977bfd4846e7c15f9388a7cdf9b3e074",
  oddsEntry: "b1635a40e4b6493e8df0cfd15367e65228851154cda9503f87b75d281466fe8d",
  viewItem: "a9b01fbf94747cfa3a97ad0ef97b391e291c847c7f661e5f2b807fbfb9445284",
  http: "e3ab6ae4145b03e01cb0ea1c5d210a6e6765bfe12ff873bf171e17e1f3332d1d",
  headers: "b1c216a1246963f94ae1c27ee27aa51c51195c35a5aef81821e1dc751780dc5a",
  oddsStore: "8ca54649621fd8d9fd3088bc90ca3049f45fd1b23bbbdfe4c38807bde679302b",
  accountCheck: "f9a86321d6c21378556fe3ffcd77bbc6b263208637e8af3aaa9374e2e1b2d84e",
  pairPrecheck: "9a89eaaf29845eb30424d35878d016768d55fac2793b6b818e474fc00d9d328d",
};
const text = (key: string) => fixture.fragments[key]!.text;
const wire = (value: unknown) => JSON.stringify(value);
const account = (proxyId: number) => new PlatformAccount({provider: "RAY", accountId: 1,
  gateway: "https://ray.example", token: "Bearer reference", currency: "CNY", proxyId,
  referer: "https://ray.example/app", userAgent: "reference-agent"});
const quote = () => ({code: 200, result: {start_time: "2099-01-01", odds: [{
  odds_id: "100", enable_parlay: 1, status: 1, odds: "1.88", bet_limit: [10, 3000],
  match_name: "A vs B", group_name: "获胜者", name: "A", match_stage: "final", last_update: "1792536816",
}]}});

function original(response: unknown, submit: unknown = {code: 200, result: 900}) {
  const calls: Array<{method: string; url: string; headers: Record<string, string>; body?: string;
    timeout?: number; validateStatus?: (status: number) => boolean}> = [];
  const dispatch = async (method: string, url: string, config: {headers: Record<string, string>;
    timeout?: number; validateStatus?: (status: number) => boolean}, body?: string) => {
    calls.push({method, url, headers: {...config.headers}, body, timeout: config.timeout, validateStatus: config.validateStatus});
    return {data: structuredClone(method === "POST" ? submit : response)};
  };
  const context = vm.createContext({Date, Map,
    Te: (object: Record<string, unknown>, key: string, value?: unknown) => {object[key] = value;},
    se: (value: unknown) => ({value}), wp: (_name: string, setup: () => unknown) => setup(),
    Gt: {RAY: "RAY", HG: "HG"}, wr: {axios: 0}, PT: "https://relay.example",
    Pn: () => ({proxylist: new Map([[7, {url: "socks5://proxy.example:1080"}]])}),
    Mr: {get: (url: string, config: {headers: Record<string, string>}) => dispatch("GET", url, config),
      post: (url: string, body: string, config: {headers: Record<string, string>}) => dispatch("POST", url, config, body)},
    Un: {get: () => {throw Error("unexpected extension transport");}},
    // Only the form codec is a test port; the provider and HTTP route decisions are original A8 source.
    pa: {stringify: (body: Record<string, string>) => Object.entries(body).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")},
    Ha: () => ({send: {LimitMessage: () => "limit"}}), _r: {getCurrency: () => "CNY"},
    Ut: {saveLog: () => {}}, fo: () => ({getPlatform: () => "RAY"}),
    Jn: class {constructor(public provider: string, public success: boolean, public message: string,
      public request: unknown, public response: unknown) {}},
  });
  vm.runInContext(`class lu{constructor(account){this.account=account}};${text("oddsEntry")};
    const counter=${text("oddsStore")};const Qn=()=>counter;const l1=${text("headers")};const gr=${text("http")};
    ${text("betOption")};${text("viewItem")};${text("rayProvider")};
    const Pd={GetProvider:account=>new rHe(account)};const accountCheck=${text("accountCheck")};`, context);
  return {
    calls, context,
    provider: (acc: PlatformAccount) => new (vm.runInContext("rHe", context))(acc),
    check: vm.runInContext("accountCheck", context) as (account: PlatformAccount, option: BetOption) => Promise<BetOption>,
    option: () => new (vm.runInContext("If", context))("400", "200", "100", "RAY", 100, "Home", 1.89) as BetOption,
    read: () => vm.runInContext('counter.getOdds("RAY","100",2)', context) as number,
  };
}

describe("A8 RAY execution chain", () => {
  const cache = new Map<string, {odds: number; isLock: boolean}>();
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-22T00:00:00Z")); http.request.mockReset(); cache.clear();
    registerOddsAccess({read: (_p, id, fallback) => cache.get(id)?.odds ?? fallback,
      save: (_p, entry) => {cache.set(entry.id, entry);}, clean: () => {}, isOdds: (_p, id) => cache.has(id),
      getEntry: () => undefined, updateOddsLock: () => {}, updateBetLock: () => {}, updateMessage: () => {},
      getLimit: () => undefined, setLimit: () => {}});
    registerPlatformHttpContext({getToken: () => null, getAuthHeaders: async () => ({}),
      getApiBase: () => "https://relay.example", getProxyUrl: () => "socks5://proxy.example:1080"});
    http.request.mockImplementation(async (config: {method: string}) => ({status: 200, headers: {},
      data: wire(config.method === "POST" ? {code: 200, result: 900} : quote())}));
  });
  afterEach(() => {clearOddsAccess(); clearPlatformHttpContext(); vi.useRealTimers();});

  it("pins all original fragments, including the account catch, quote store and loop failure path", () => {
    expect(fixture.sourceSha256).toBe("1b07f16f69846aedb3f863cf85a2c1f3497aec0e69ce0b2b3aef054c1c5aa0e2");
    for (const [name, sha] of Object.entries(pins)) {
      expect(createHash("sha256").update(text(name)).digest("hex"), name).toBe(sha);
      expect(fixture.fragments[name]!.sha256).toBe(sha);
    }
  });

  it("uses the original HTTP timeout and validateStatus without changing other venue JSON-error handling", async () => {
    const reference = original(quote()); await reference.check(account(0), reference.option());
    const {a8Axios} = await vi.importActual<typeof import("@changmen/client-core/shared/a8Axios")>("@changmen/client-core/shared/a8Axios");
    expect(a8Axios.defaults.timeout).toBe(reference.calls[0]!.timeout);
    for (const status of [200, 400, 401, 403, 429, 500, 502, 503, 504])
      expect(a8Axios.defaults.validateStatus!(status)).toBe(reference.calls[0]!.validateStatus!(status));
    http.request.mockResolvedValue({status: 401, headers: {"content-type": "application/json"}, data: wire({msg: "original error policy"})});
    await expect(accountHttpRequest(account(0), "https://other-venue.example", {})).rejects.toThrow("original error policy");
  });

  it.each([0, 7])("prechecks directly, preserves the A8 JSON, then submits with account proxyId=%s", async proxyId => {
    const acc = account(proxyId), reference = original(quote()), expected = reference.option();
    const actual = new BetOption("RAY", "400", "200", "100", 100, "Home", 1.89);
    await reference.check(acc, expected);
    await rayProvider.checkBet(acc, actual);
    expect(wire(actual.data)).toBe(wire(expected.data));
    expect(actual.odds).toBe(expected.odds);
    expect(cache.get("100")?.odds).toBe(reference.read());
    const [get] = http.request.mock.calls.map(call => call[0]);
    expect(get.url).toBe(reference.calls[0]!.url);
    expect(get.headers.authorization).toBe(reference.calls[0]!.headers.authorization);
    expect(get.headers["x-proxy-url"]).toBeUndefined();
    expect(get.withCredentials).toBe(false);
    const result = await rayProvider.betting(acc, actual);
    const expectedResult = await reference.provider(acc).betting(expected);
    expect(result.success).toBe(expectedResult.success);
    expect(result.message).toBe(expectedResult.message);
    const post = http.request.mock.calls[1]![0], expectedPost = reference.calls[1]!;
    expect(post.headers["x-proxy-url"]).toBe(expectedPost.headers["x-proxy-url"]);
    expect(post.headers["x-proxy"]).toBe(expectedPost.headers["x-proxy"]);
    expect(post.withCredentials).toBe(Boolean(proxyId));
    expect(new URLSearchParams(post.data).get("order")).toBe(new URLSearchParams(expectedPost.body).get("order"));
    expect(cache.get("100")?.odds).toBe(reference.read());
    expect(cache.get("100")?.odds).toBe(0);
  });

  it.each([200, 501, 500])("applies the same quote-cache update after submit code=%s", async code => {
    const response = {code, result: code === 501 ? [{odds: "1.70"}] : 900, desc: "venue rejected"};
    const acc = account(0), reference = original(quote(), response), expected = reference.option();
    const actual = new BetOption("RAY", "400", "200", "100", 100, "Home", 1.89);
    await reference.check(acc, expected); await rayProvider.checkBet(acc, actual);
    http.request.mockResolvedValue({status: 200, headers: {}, data: wire(response)});
    const result = await rayProvider.betting(acc, actual), expectedResult = await reference.provider(acc).betting(expected);
    expect(result.success).toBe(expectedResult.success);
    expect(cache.get("100")?.odds).toBe(reference.read());
    expect(cache.get("100")?.odds).toBe(code === 501 ? 1.7 : 0);
    if (code !== 501) expect(result.message).toBe(expectedResult.message);
  });

  it("uses account routing for balance and direct routing for order reads", async () => {
    const acc = account(7), reference = original({code: 200, result: {balance: "900"}});
    http.request.mockResolvedValue({status: 200, headers: {}, data: wire({code: 200, result: {balance: "900"}})});
    expect((await rayProvider.getBalance!(acc))?.balance).toBe((await reference.provider(acc).getBalance()).balance);
    expect(http.request.mock.calls[0]![0].headers["x-proxy-url"]).toBe(reference.calls[0]!.headers["x-proxy-url"]);
    http.request.mockResolvedValue({status: 200, headers: {}, data: wire({code: 200, result: []})});
    await rayProvider.getOrders!(acc);
    expect(http.request.mock.calls[1]![0].url).toBe("https://ray.example/v2/order");
    expect(http.request.mock.calls[1]![0].headers["x-proxy-url"]).toBeUndefined();
  });

  it("encodes the A8 form as RFC3986, including spaces, symbols, newline and Unicode", async () => {
    await accountPostForm(account(0), "/v2/order", {order: "A B!()*'\n主队+"});
    expect(http.request.mock.calls[0]![0].data).toBe("order=A%20B%21%28%29%2A%27%0A%E4%B8%BB%E9%98%9F%2B");
  });

  it.each([400, 401, 403, 429, 503])("preserves the A8 accepted HTTP %s business response instead of throwing away its code", async status => {
    const response = {code: status, msg: "venue business response", desc: "venue rejected"};
    const reference = original(response), expected = reference.option();
    await reference.check(account(0), expected);
    const actual = new BetOption("RAY", "400", "200", "100", 100, "Home", 1.89);
    http.request.mockResolvedValue({status, headers: {"content-type": "application/json"}, data: wire(response)});
    expect(await rayProvider.checkBet(account(0), actual)).toBe(actual);
    expect(actual.data).toBeNull(); expect(actual.checkError).toBe(expected.checkError);
    expect(actual.response).toEqual(response);
  });

  it.each([500, 504])("keeps the A8 HTTP %s transport rejection boundary", async status => {
    // Axios applies validateStatus before accountHttpRequest sees the response.
    http.request.mockRejectedValue(Object.assign(new Error(`HTTP ${status}`), {response: {status}}));
    await expect(rayProvider.checkBet(account(0), new BetOption("RAY", "400", "200", "100", 100, "Home", 1.89)))
      .rejects.toMatchObject({response: {status}});
  });

  it("executes the original paired-precheck failure branch: one-second wait, no hidden cache cleanup", async () => {
    const reference = original({code: 200, result: null}), first = reference.option(), second = reference.option();
    vm.runInContext('counter.save("RAY",new _n("100",2,false,"200"))', reference.context);
    const wait = vi.fn(async () => {});
    const pair = vm.runInContext(`(async(h,ne,Oe,ge,ve,dt)=>{
      for(let attempt=0;attempt<1;attempt++){${text("pairPrecheck")}return "prepared";}return "blocked";
    })`, reference.context);
    expect(await pair({checkBetting: reference.check}, account(0), account(0), first, second, {wait})).toBe("blocked");
    expect(wait).toHaveBeenCalledExactlyOnceWith(1000);
    expect(first.checkError).toBe("{}"); expect(reference.read()).toBe(2);
    expect(reference.calls.every(call => call.method === "GET")).toBe(true);
  });

  it.each([
    ["null response", null], ["null result", {code: 200, result: null, etag: "empty"}],
    ["missing result", {code: 200}], ["missing list", {code: 200, result: {}}],
    ["non-array list", {code: 200, result: {odds: {}}}],
    ["null selection row", {code: 200, result: {odds: [null]}}],
    ["missing selection", {code: 200, result: {odds: []}}],
    ["missing limits", {code: 200, result: {odds: [{...quote().result.odds[0], bet_limit: undefined}]}}],
    ["incomplete limits", {code: 200, result: {odds: [{...quote().result.odds[0], bet_limit: [10]}]}}],
    ["null limit", {code: 200, result: {odds: [{...quote().result.odds[0], bet_limit: [10, null]}]}}],
    ["invalid limits", {code: 200, result: {odds: [{...quote().result.odds[0], bet_limit: ["bad", "bad"]}]}}],
    ["missing odds", {code: 200, result: {odds: [{...quote().result.odds[0], odds: undefined}]}}],
    ["invalid odds", {code: 200, result: {odds: [{...quote().result.odds[0], odds: "bad"}]}}],
    ["zero odds", {code: 200, result: {odds: [{...quote().result.odds[0], odds: 0}]}}],
  ])("approved repair: %s invalidates both the cached odds and any previous prepared order", async (_name, response) => {
    const actual = new BetOption("RAY", "400", "200", "100", 100, "Home", 1.89);
    actual.data = {oldPreparedOrder: true}; cache.set("100", {odds: 2, isLock: false});
    const item = new ViewBetItem({Type: "RAY", BetID: "200", HomeID: "100", AwayID: "101",
      HomeOdds: 2, AwayOdds: 2}, "400");
    expect(item.getOdds("Home")).toBe(2);
    http.request.mockResolvedValue({status: 200, headers: {}, data: wire(response)});
    expect(await rayProvider.checkBet(account(0), actual)).toBe(actual);
    expect(actual.data).toBeNull(); expect(actual.checkError).toContain("RAY 无盘口数据");
    expect(cache.get("100")?.odds).toBe(0);
    expect(item.getOdds("Home")).toBe(0);
    expect(http.request.mock.calls.every(call => call[0].method === "GET")).toBe(true);
  });

  it("proves the original outer catch keeps the stale quote, while the approved repair prevents its reuse", async () => {
    const response = {code: 200, result: null, etag: "empty"}, reference = original(response);
    const expected = reference.option();
    vm.runInContext('counter.save("RAY",new _n("100",2,false,"200"))', reference.context);
    await reference.check(account(0), expected);
    expect(expected.checkError).toBe("{}"); expect(reference.read()).toBe(2);
    cache.set("100", {odds: 2, isLock: false});
    const actual = new BetOption("RAY", "400", "200", "100", 100, "Home", 1.89);
    http.request.mockResolvedValue({status: 200, headers: {}, data: wire(response)});
    await rayProvider.checkBet(account(0), actual);
    expect(cache.get("100")?.odds).toBe(0);
    // An ordinary subsequent quote is allowed to restore this item; there is no permanent blacklist.
    http.request.mockResolvedValue({status: 200, headers: {}, data: wire(quote())});
    const recovered = new BetOption("RAY", "400", "200", "100", 100, "Home", 1.89);
    await rayProvider.checkBet(account(0), recovered);
    expect(recovered.data).not.toBeNull(); expect(cache.get("100")?.odds).toBe(1.88);
  });
});
