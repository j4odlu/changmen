import { afterEach, expect, test, vi } from "vitest";
import { loadObFootball, obSnapshot } from "./__tests__/obFootballOriginal";

const NOW = 1_800_000_000_000;
const ids = ["5652292", "5652293", "5652294"];
const play = (hpid = "4", hid = hpid, hv = "-0.5") => ({ hpid, hl: [{ hid, hv,
  ol: [{ oid: `${hid}-h`, ot: "1", ov: 1.9 }, { oid: `${hid}-a`, ot: "2", ov: 1.85 }] }] });
const scenarios = ["normal", "singleflight-cache", "cache-expiry", "clear-cache", "empty-schedule", "live-failure",
  "odds-missing", "odds-rate-limit", "odds-network-failure", "detail-rate-limit", "english-refresh", "trial-failure",
  "chinese-failure", "chinese-placeholder", "no-session", "no-gateway", "dto-by-mid", "dto-live-fallback", "invalid-mid",
  "markets-list", "markets-detail", "markets-detail-failure", "get", "get-with-query", "post", "http-failure", "envelope-failure",
  "batch-shrink", "rate-limit-exhausted"];
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

test.each(scenarios)("OB request/cache/session sequence %s matches the original module with no real HTTP", async scenario => {
  async function run(original: boolean) {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const trace: unknown[][] = [];
    const record = (kind: string, ...args: unknown[]) => { trace.push([Date.now() - NOW, kind, obSnapshot(args)]); };
    let session: any = scenario === "no-session" ? null : { token: "offline-trial", gateway: "https://sport.example",
      lang: scenario === "english-refresh" || scenario === "trial-failure" ? "zh" : "en", sessionId: "12345678901234567890" };
    let oddsCalls = 0, detailCalls = 0;
    const waveIds = scenario === "batch-shrink" ? Array.from({ length: 25 }, (_, i) => String(5652300 + i)) : ids;
    const row = (mid: string) => ({ mid, tid: "180", tn: "Premier League", tnjc: "英超", mhn: `Home ${mid}`, man: `Away ${mid}`,
      mgt: NOW + 1800_000, hps: [play(), play("18", "half", "1.5")], mmp: "1", mst: "300", msc: ["S0|1:0"] });
    const post = async (url: string, body: any, opts: unknown) => {
      record("post", url, body, opts);
      if (scenario === "http-failure") return { status: 503, data: "offline failure" };
      if (scenario === "envelope-failure") return { status: 200, data: { code: "session-expired", msg: "offline failure" } };
      let data: unknown;
      if (url.includes("structureTournamentMatchesPB")) {
        if (scenario === "empty-schedule") data = [];
        else if (body.euid === "30002") {
          if (scenario === "live-failure") throw new Error("live offline");
          data = [{ csid: "1", tid: "180", tn: "Premier League", mids: waveIds.at(-1), mgt: NOW - 8 * 3600_000 }];
        }
        else data = [{ csid: "1", tid: "180", tn: "Premier League", mids: waveIds.slice(0, -1).join(","), mgt: NOW + 1800_000 }];
      }
      else if (url.includes("structureMatchBaseInfoByMidsPB")) {
        oddsCalls++;
        if (scenario === "rate-limit-exhausted" || scenario === "odds-rate-limit" && oddsCalls <= 2
          || scenario === "batch-shrink" && oddsCalls === 1) throw new Error("0401038 too many");
        if (scenario === "odds-network-failure") throw new Error("network offline");
        const want = String(body.mids).split(",");
        data = want.filter(mid => !(scenario === "odds-missing" && mid === ids[1])
          && !(scenario === "dto-live-fallback" && body.euid !== "30002")
          && !["detail-rate-limit", "chinese-placeholder"].includes(scenario))
          .map(mid => row(mid));
      }
      else if (url.includes("getMatchBaseInfoByOddsPB")) {
        detailCalls++;
        if (scenario === "markets-detail-failure") throw new Error("detail offline");
        if (scenario === "detail-rate-limit" && detailCalls <= 2) throw new Error("0401038 too many");
        data = scenario === "chinese-placeholder" ? [{ mid: body.mid }] : [{ ...row(body.mid), hps: [play("4", "alternate", "-1")] }];
      }
      else data = { received: body };
      return { status: 200, data: { code: "0000000", data } };
    };
    const ports = {
      console: { warn: (...args: unknown[]) => record("warn", ...args) },
      "@changmen/client-core/shared/a8Axios": { a8Axios: { post, get: async (...args: unknown[]) => {
        record("get", ...args); return { status: 200, data: { code: "0", data: { ok: true } } };
      } }, responseBodyText: String },
      "@/runtime/obSportMarketMeta": { rememberObSportMarketMeta: (...args: unknown[]) => record("market-meta", ...args),
        clearObSportMarketMeta: () => record("clear-market-meta") },
      "@/runtime/obSportEnglishNames": { rememberObEnglishNames: (...args: unknown[]) => record("english-names", ...args) },
      "@/runtime/obSportChineseNames": {
        refreshObChineseNamesForMids: async (...args: unknown[]) => { record("chinese-refresh", ...args);
          if (scenario === "chinese-failure") throw new Error("Chinese offline"); },
        peekObChineseNames: (mid: string) => { record("chinese-peek", mid); return { home: "中文主队", away: "中文客队" }; },
      },
      "@/runtime/obSportSessionLocal": {
        readLocalSportObSession: () => { record("read-session"); return session; },
        parseSportObSessionInput: (input: string) => ({ ok: true, session: JSON.parse(input) }),
        writeLocalSportObSession: (next: unknown) => { record("write-session", next); session = next; return next; },
      },
      "@/runtime/obSportTrial": {
        resolveObSportHttpGateway: (gateway: string) => scenario === "no-gateway" ? "" : gateway,
        fetchPandaSportTrialRow: async (...args: unknown[]) => { record("trial", ...args);
          if (scenario === "trial-failure") throw new Error("trial offline");
          return { ...session, token: "offline-refreshed", gateway: "https://sport.example", lang: "en" }; },
        formatPandaSportTrialPaste: JSON.stringify,
      },
    };
    const api = loadObFootball(original, ports).api;
    async function drain(work: Promise<unknown>) {
      const result = work.then(value => ({ value }), error => ({ error: String(error.message), code: error.code }));
      for (let i = 0; i < 100; i++) await Promise.resolve();
      await vi.runAllTimersAsync();
      return result;
    }
    let result: unknown;
    if (scenario.startsWith("markets-")) result = await drain(api.fetchObFootballMatchMarkets(ids[0], { includeDetail: scenario !== "markets-list" }));
    else if (scenario.startsWith("dto-") || scenario === "invalid-mid") result = await drain(api.fetchObFootballDtoByMid(
      scenario === "invalid-mid" ? "2097200625505820674" : ids[0], { home: "Hint Home", away: "Hint Away", tid: "180" }));
    else if (scenario === "get" || scenario === "get-with-query") result = await drain(api.getObSportPb(
      scenario === "get" ? "/offline" : "/offline?original=yes", { q: "keep value" }));
    else if (["post", "http-failure", "envelope-failure"].includes(scenario)) result = await drain(api.postObSportPb("/offline", { keep: 1 }));
    else if (scenario === "singleflight-cache") {
      const results: any = await drain(Promise.all([api.fetchObFootballAsClientMatchDtos(), api.fetchObFootballAsClientMatchDtos()]));
      expect(results.value[0]).toBe(results.value[1]);
      result = { first: results, cached: await drain(api.fetchObFootballAsClientMatchDtos()) };
    }
    else {
      result = await drain(api.fetchObFootballAsClientMatchDtos());
      if (scenario === "cache-expiry") {
        await vi.advanceTimersByTimeAsync(9999); await drain(api.fetchObFootballAsClientMatchDtos());
        await vi.advanceTimersByTimeAsync(2); result = await drain(api.fetchObFootballAsClientMatchDtos());
      }
      if (scenario === "clear-cache") {
        api.clearObFootballClientCache(); expect(api.listObFootballLivePatches()).toEqual([]);
        result = await drain(api.fetchObFootballAsClientMatchDtos());
      }
    }
    const snapshot = obSnapshot({ result, trace, session, live: api.listObFootballLivePatches(), timers: vi.getTimerCount() });
    vi.clearAllTimers(); vi.useRealTimers();
    return snapshot;
  }
  const original = await run(true), current = await run(false);
  expect(current).toEqual(original);
  expect(current.timers).toBe(0);
  if (scenario === "normal") {
    expect(current.result.value).toHaveLength(3);
    expect(current.trace.filter((r: any[]) => r[1] === "post")).toHaveLength(3);
  }
});
