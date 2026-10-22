// [changmen 扩展] 直接运行功能加入前后的完整源码；不经过历史源码还原器。
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const baseline = "2d1efc55ffabdfbe62abe4a5dbe6335bed38822a";
const bettingRoot = "client/web/src/stores/betting/";
const own = {
  "@/stores/betting/execution/selection": `${bettingRoot}execution/selection.ts`,
  "@/domain/betting/singleLegRate": "client/web/src/domain/betting/singleLegRate.ts",
  "@/stores/betting/autoBet/phases/types": `${bettingRoot}autoBet/phases/types.ts`,
  "@changmen/client-core/shared/format": "client/packages/client-core/src/shared/format.ts",
  ...Object.fromEntries(["prepareArbAttempt", "checkArbLegs", "placeArbLegs", "finalizeArbBet", "finalizeArbMessaging"].map(name =>
    [`@/stores/betting/autoBet/phases/${name}`, `${bettingRoot}autoBet/phases/${name}.ts`])),
};
const compiled = new Map();
function code(file, old) {
  const key = `${old}:${file}`;
  if (!compiled.has(key)) {
    const source = old
      ? execFileSync("git", ["show", `${baseline}:${file}`], { cwd: root, encoding: "utf8" })
      : fs.readFileSync(path.join(root, file), "utf8");
    compiled.set(key, ts.transpileModule(source, { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    } }).outputText);
  }
  return compiled.get(key);
}
const snapshot = value => JSON.parse(JSON.stringify(value, (_key, item) => {
  if (typeof item === "function") return "[function]";
  if (item instanceof Map) return [...item];
  return item;
}));

async function run(old, scenario) {
  const events = [];
  const record = (name, ...args) => { events.push([name, snapshot(args)]); };
  const spy = (name, result) => (...args) => { record(name, ...args); return result; };
  const at = 1_792_680_000_123;
  const makeLeg = (type, side, money, odds) => ({
    type, target: side, betMoney: money, odds, matchId: "venue-match", betId: "venue-market", itemId: side,
  });
  const legs = [makeLeg(scenario.noPm ? "OB" : "Polymarket", "Home", 65, 3.1), makeLeg("RAY", "Away", 115, scenario.equal ? 3.1 : 1.7)];
  const accounts = legs.map((leg, i) => ({
    provider: leg.type, accountId: i + 1, playerName: `account-${i + 1}`, platformName: leg.type,
    getBalance: () => 10_000,
    rateConfig: [{ minOdds: 0, maxOdds: 0, rate: scenario.single === (i === 0 ? "A" : "B") ? 9999 : 1 }],
  }));
  const prefs = {
    ...(scenario.pref !== undefined ? { arbExecutionMode: scenario.pref } : {}),
    ...(scenario.losCOnly ? { lowOddsSingleHigherCProbabilityOnly: true } : {}),
    pmArbOrderMode: scenario.gtc ? "GTC" : "FOK", pmGtcV1Activation: "1:owner",
    arbAllowedPlatforms: null, stakeScaleByProfit: { enabled: false },
    singleLeg9999MaxPerMap: 1, singleLeg9999Precheck: scenario.precheck9999 !== false,
    arbFailAutoSell: { enabled: Boolean(scenario.autoSell) },
  };
  const user = { userId: "owner", extensionPrefs: prefs };
  const trace = { event: spy("trace.event"), finish: spy("trace.finish"), getMeta: () => ({}) };
  const params = {
    match: { id: 10, title: "A vs B", liveRound: 1 },
    bet: { id: 20, round: 1, homeName: "A", awayName: "B", getBetName: () => "match winner",
      items: [{ updateOdds: spy("updateOdds") }],
      getOrderOptions: (...args) => { record("options", ...args); return scenario.noOptions ? null : legs; } },
    config: { betMoney: 100, minMoney: scenario.randomStake ? 80 : 0, maxMoney: scenario.randomStake ? 120 : 0,
      noSameBet: true, betSorting: scenario.parallel ? "Parallel" : "Serial", anyOdds: true, makeUp: true,
      checkTimeout: 10_000 },
    setMessage: spy("message"), trace,
  };
  const isFailure = leg => scenario.fail === leg.target;
  const accountStore = {
    accounts,
    getProviders: (...args) => { record("providers", ...args); return new Map(accounts.map(a => [a.provider, true])); },
    getAccount: (provider, money, exclude, filter, options) => {
      record("pickAccount", provider, money, exclude, options);
      if (scenario.noAccounts) return undefined;
      return accounts.find(a => a.provider === provider && filter(a));
    },
    checkBetting: async (account, leg, options) => {
      record("check", account, leg, options);
      if (scenario.checkThrow) throw new Error("precheck exception");
      leg.data = scenario.checkFail === leg.target ? null : { prepared: leg.target };
      if (!leg.data) leg.checkError = "quote rejected";
      if (scenario.checkErrorWithData) leg.checkError = "existing data with error";
      leg.newOdds = scenario.reverseOdds ? (leg.target === "Home" ? 1.5 : 3.2) : leg.odds;
      return leg;
    },
    betting: async (account, leg, waitSec, opts) => {
      record("submit", account, leg, waitSec, opts);
      if (scenario.submitThrow) throw new Error("submit exception");
      return { provider: leg.type, success: !isFailure(leg), orderId: `${leg.type}-order`,
        ...(scenario.unknown && leg.type === "Polymarket" ? { success: false, pmSubmitUnknown: true, pending: true } : {}),
        ...(scenario.pending ? { pending: true } : {}) };
    },
  };
  const functions = {
    getActivePinia: () => scenario.noPinia ? undefined : {}, useUserStore: () => user,
    useAccountStore: () => accountStore, useMatchStore: () => ({}),
    useLoseOrderStore: () => ({ orders: new Map(scenario.pendingError ? [[99, {
      pendingVenueOrderId: "unknown", pendingVenueError: "timeout", pendingVenueAccountId: 1,
    }]] : []) }),
    accountsFundingReady: () => !scenario.fundingNotReady,
    accountPassesMainBetFilter: () => true, explainMainBetAccountRejection: () => null,
    filterArbProviderKeys: keys => keys, opponentSide: side => side === "Home" ? "Away" : "Home",
    applyStakeScaleByProfit: () => 1, shouldSkipAccountRateOnStakeScale: () => false,
    readUsedAccounts: spy("usedAccounts", []), ensureArbExecutionTrace: () => {},
    setArbExecutionTraceMeta: spy("trace.meta"),
    buildArbProgressLegPair: (...args) => snapshot(args),
    capturePmFokPreflightMode: spy("pm.mode", scenario.optimized ? "optimized" : "legacy"),
    prewarmPmSportForCandidate: spy("pm.prewarm"), prepareOptimizedFokExecution: spy("pm.prepare"),
    getPolymarketPmSportBlockReasonFromOption: () => scenario.pmBlocked ? "market blocked" : null,
    PLATFORMS: { Polymarket: "Polymarket" },
    arbBetToastSeconds: () => 10, wait: spy("wait"), a8Tip: spy("tip"),
    createObservationContext: () => ({ id: "observation" }), observeOption: spy("observe"),
    observeArbSubmissionBlocked: spy("blocked"), recordPmExecutionMetric: spy("pm.metric"),
    validatePolymarketPreparedBuy: () => scenario.invalidPrepared ? "prepared quote expired" : null,
    isPendingConfirmVenueProvider: provider => provider === "RAY",
    formatBetResult: (...args) => JSON.stringify(snapshot(args)),
    formatLegAccount: (provider, name) => `${provider} ${name}`,
    retryFailedLeg: spy("retry", scenario.retrySuccess ? { result: { success: true, orderId: "retry" }, leg: legs[1], account: accounts[1] } : null),
    gtcSelectionHistoryStatus: spy("gtc.history", null), gtcHistoryAllowsAccount: () => true,
    prepareGtcLegExecution: async (_params, ready) => {
      record("gtc.prepare", ready);
      return { legs: new Map(legs.map((leg, i) => [leg, {
        validate: spy(`gtc.validate.${i}`), submit: () => accountStore.betting(accounts[i], leg, 10, { gtc: true }),
      }])), actions: { retry: false, makeup: false, autoSell: false, registerRejectMonitor: false },
      finishSubmission: spy("gtc.finishSubmission"), close: spy("gtc.close"),
      summary: () => ({ message: "GTC complete", traceStatus: "success" }) };
    },
    singleLeg9999MapKey: (...args) => `map:${args.join(":")}`,
    singleLeg9999SourceMarketKey: (...args) => `source:${args.join(":")}`,
    singleLeg9999SourceSideKey: (...args) => `side:${args.join(":")}`,
    hasSingleLeg9999OppositeSourceSide: () => false,
    getSingleLeg9999MapCountForKeys: () => scenario.countFull ? 1 : 0,
    reserveSingleLeg9999MapFillKeys: spy("9999.reserve", true),
    releaseSingleLeg9999MapFillKeys: spy("9999.releaseKeys"), releaseSingleLeg9999MapFill: spy("9999.release"),
    recordSingleLeg9999MapFillKeys: spy("9999.fillKeys"), recordSingleLeg9999MapFill: spy("9999.fill"),
    applyValueBetMoneyTo9999LiveLeg: () => null,
    resolve9999LiveSide: (a, b) => a && !b ? "A" : b && !a ? "B" : null,
    explain9999CProbabilityRejection: () => null,
    refreshOrderListAfterBind: spy("refresh"), markArbSuccessLegs: spy("mark"),
    resolveArbMakeUpSuccessRef: () => ({ betMoney: 100, betOdds: 2 }),
    registerRayOrderContext: spy("ray.context"),
    applyArbMakeUpFromRejects: spy("makeup", { enqueuedForLegA: false, enqueuedForLegB: Boolean(scenario.reject) }),
    syncArbFinalizeActiveBet: (_id, _placed, settle, makeup) => ({
      okA: !settle.rejectA && !settle.pendingConfirmA, okB: !settle.rejectB && !settle.pendingConfirmB,
      makeupQueued: makeup.enqueuedForLegB,
    }),
    useMessageStore: () => ({ bettingMessage: spy("notification") }),
    maybeArbFailAutoSellAfterFinalize: spy("autoSell"),
    settleBothArbLegs: async (_params, placed) => {
      record("settle", placed);
      return { ordersA: placed.resultA?.success ? [{ orderId: "a" }] : [], ordersB: placed.resultB?.success ? [{ orderId: "b" }] : [],
        rejectA: false, rejectB: Boolean(scenario.reject), pendingConfirmA: Boolean(scenario.unknown),
        pendingConfirmB: Boolean(scenario.pending), boundLegLabels: [], bindFailedLegLabels: [], bindFailedSides: [] };
    },
    isPrematchFullMarketAllowed: () => !scenario.prematchBlocked, isMapMuteActive: () => Boolean(scenario.muted),
    beginExecutionObservation: spy("beginObservation", { id: "observation" }),
    finishExecutionObservation: spy("finishObservation"), recordArbAttemptMetric: spy("metric"),
  };
  for (const name of ["syncActiveBetBegin", "syncActiveBetPhase", "syncActiveBetFail", "syncActiveBetLeg",
    "syncActiveBetPrecheckResults", "syncActiveBetPlaceResults", "scheduleActiveBetRunRemoval", "syncActiveBetBindSuccess", "syncActiveBetBindFailed"])
    functions[name] = spy(name);
  const cache = new Map();
  let performanceTick = 0;
  const unavailable = () => { throw new Error("default path touched low-odds storage/selection"); };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const sandbox = vm.createContext({ exports, module: { exports }, Error, Map, console,
      Date: class extends Date { static now() { return at; } },
      Math: Object.assign(Object.create(Math), { random: () => 0.5 }),
      performance: { now: () => performanceTick++ },
      require: name => {
        if (name === "@/extensions/arbBet/lowOddsSingle") return new Proxy({}, { get: () => unavailable });
        return own[name] ? load(own[name]) : functions;
      },
    });
    Object.defineProperty(sandbox, "localStorage", { get: unavailable });
    Object.defineProperty(sandbox, "navigator", { get: unavailable });
    vm.runInContext(code(file, old), sandbox, { filename: file, timeout: 2000 });
    return exports;
  }
  await load(`${bettingRoot}autoBet/executeArbBet.ts`).executeArbBet(params);
  return events;
}

const scenarios = {
  serial: {}, parallel: { parallel: true }, nonPm: { noPm: true }, nonPmParallel: { noPm: true, parallel: true },
  confirmedOddsReverse: { reverseOdds: true }, equalOdds: { equal: true }, randomStake: { randomStake: true },
  firstSubmitFails: { fail: "Home" }, secondSubmitFails: { fail: "Away" },
  parallelFirstFails: { parallel: true, fail: "Home" }, parallelSecondFails: { parallel: true, fail: "Away" },
  secondRetrySucceeds: { fail: "Away", retrySuccess: true }, rejectWithMakeup: { reject: true },
  autoSellEnabled: { reject: true, autoSell: true }, pmUnknown: { unknown: true }, venuePending: { pending: true },
  firstCheckFails: { checkFail: "Home" }, secondCheckFails: { checkFail: "Away" },
  checkDataAndError: { checkErrorWithData: true }, checkException: { checkThrow: true }, submitException: { submitThrow: true },
  pendingAnchorBlocked: { pendingError: true }, fundingNotReady: { fundingNotReady: true },
  noOptions: { noOptions: true }, noAccounts: { noAccounts: true }, prematchBlocked: { prematchBlocked: true }, muted: { muted: true },
  pmMarketBlocked: { pmBlocked: true }, preparedQuoteInvalid: { invalidPrepared: true }, optimizedFok: { optimized: true },
  single9999A: { single: "A" }, single9999B: { single: "B" },
  single9999WithoutPeerCheck: { single: "A", precheck9999: false }, single9999CountFull: { single: "A", countFull: true },
  single9999CheckRejected: { single: "A", checkFail: "Home" }, single9999CheckException: { single: "A", checkThrow: true },
  single9999Reject: { single: "B", reject: true },
  gtc: { gtc: true }, gtcParallel: { gtc: true, parallel: true }, gtcWithoutPm: { gtc: true, noPm: true },
  noActivePinia: { noPinia: true },
};

describe("ordinary execution before/after 🎯, using raw source and identical boundary mocks", () => {
  for (const { pref, losCOnly } of [
    { pref: undefined }, { pref: "normal" }, { pref: "unknown" }, { pref: null }, { pref: false },
    { pref: undefined, losCOnly: true }, { pref: "normal", losCOnly: true },
  ])
    it.each(Object.entries(scenarios))(`preference ${String(pref)}, LOS C filter ${!!losCOnly}: %s`, async (_name, scenario) => {
      const input = { ...scenario, pref, losCOnly };
      const previous = await run(true, input);
      const current = await run(false, input);
      expect(current).toEqual(previous);
      // 防止异常被 execute 的 catch 吞掉后，两个版本一起“通过”。
      const unexpected = current.filter(([name, args]) => name === "message"
        && String(args[0]).includes("自动下单异常")
        && !scenario.checkThrow && !scenario.submitThrow);
      expect(unexpected).toEqual([]);
      if (!scenario.noOptions && !scenario.noAccounts && !scenario.prematchBlocked && !scenario.muted && !scenario.fundingNotReady)
        expect(current.some(([name]) => name === "syncActiveBetBegin")).toBe(!scenario.countFull);
      const noSubmit = scenario.noOptions || scenario.noAccounts || scenario.prematchBlocked || scenario.muted
        || scenario.fundingNotReady || scenario.countFull || scenario.checkFail || scenario.checkThrow
        || scenario.pendingError || scenario.pmBlocked || scenario.invalidPrepared;
      const submitCount = noSubmit ? 0 : scenario.single || scenario.submitThrow || scenario.unknown
        || (!scenario.parallel && scenario.fail === "Home") ? 1 : 2;
      expect(current.filter(([name]) => name === "submit")).toHaveLength(submitCount);
      if (scenario.autoSell)
        expect(current.some(([name]) => name === "autoSell")).toBe(true);
      if (scenario.gtc && !scenario.noPm)
        expect(current.some(([name]) => name === "gtc.prepare")).toBe(true);
    });
});
