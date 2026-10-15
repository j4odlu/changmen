// [changmen 扩展] 真实 placeBet 的离线通知故障差分；HTTP、存储与场馆边界全部模拟。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const json = value => JSON.parse(JSON.stringify(value));
const source = file => fs.readFileSync(file, "utf8");
function load(file, text, modules, globals = {}) {
  const exports = {};
  const js = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(js, { exports, module: { exports }, require: (name) => {
    assert(Object.hasOwn(modules, name), `${file}: unexpected dependency ${name}`);
    return modules[name];
  }, console, ...globals }, { filename: file, timeout: 1000 });
  return exports;
}

export async function gateway(base, providerName, failure, scenario = {}, readSource = source) {
  const file = "client/web/src/stores/account/betGateway.ts";
  const text = base ? execFileSync("git", ["show", `${base}:${file}`], { encoding: "utf8" }) : readSource(file);
  const trace = []; let notices = 0;
  const storage = new Map();
  class BetResult {
    constructor(provider, success, message = "", data, response) { Object.assign(this, { provider, success, message, data, response, link: 0 }); }
    saveLog() { trace.push("log"); }
  }
  const venue = { betting: async (_account, option) => {
    trace.push({ bet: { provider: providerName, amount: option.betMoney, odds: option.odds, data: json(option.data) } });
    if (scenario.outcome === "throw")
      throw new Error("POST timeout");
    return Object.assign(new BetResult(providerName, scenario.outcome !== "rejected", scenario.outcome === "rejected" ? "rejected" : "accepted"), { orderId: "same-order", ...(scenario.outcome === "pending" ? { pending: true } : {}) });
  } };
  const notify = () => {
    const number = ++notices;
    trace.push(number === 1 ? "loading" : "result_notice");
    if ((failure === "loading" && number === 1) || (failure === "result" && number === 2) || (failure === "terminal" && number === 3))
      throw new Error("UI unavailable");
    return { close: () => {
      trace.push("close"); if (failure === "close")
        throw new Error("UI unavailable");
    } };
  };
  const empty = {};
  const formatting = { bettingNotifyAccountLine: () => {
    if (failure === "format")
      throw new Error("UI unavailable"); return "account";
  }, bettingDetailHtml: () => "detail", bettingLoadingMessageHtml: () => "loading", bettingResultMessageHtml: () => "result" };
  const modules = {
    "@changmen/client-core/models/betOption": { BetOption: class { constructor(type, matchId, betId, itemId, betMoney, target, odds) { Object.assign(this, { type, matchId, betId, itemId, betMoney, target, odds }); } } },
    "@changmen/client-core/models/betResult": { BetResult },
    "@changmen/shared/account_multiply": { isPendingConfirmVenueProvider: provider => ["Polymarket", "RAY", "PredictFun"].includes(provider) },
    "@changmen/shared/currency": { getExchange: () => 1 },
    "@changmen/venue-adapter/adaptation": empty,
    "@/domain/polymarket/attachDetectionQuote": empty,
    "@/domain/predictfun/attachDetectionQuote": empty,
    "@/realtime/publishBetting": { publishBettingEvent: () => trace.push("publish") },
    "@/runtime/providers": { getProvider: () => venue },
    "@/services/orderObservation": { createObservationContext: () => undefined, observeOption: () => {} },
    "@/services/orderObservationEvidence": { observationFailureEvidence: () => ({}) },
    "@/services/venueSettlementEvidence": { submissionVenueStatus: () => "accepted" },
    "@/shared/a8Notify": formatting,
    "@/shared/orderSound": { playOrderSuccessSound: () => trace.push("sound") },
    "@/stores/account/pmOptimisticOrder": { persistPolymarketMatchedBuyOrder: async () => { trace.push("pm_matched_save"); return true; } },
    "@/stores/account/pmRejectOrder": { persistPolymarketExecutionReject: async () => { trace.push("pm_reject_save"); } },
    "@/stores/betting/autoBet/arbLegSettle": { settleArbLegUntilTerminal: async () => {
      trace.push("confirm_read");
      if (scenario.confirmation === "throw")
        throw new Error("confirm unavailable");
      return { rejected: scenario.confirmation === "rejected", pendingConfirm: scenario.confirmation === "pending", orders: [] };
    } },
    "@/stores/betting/successMarkers": { markSuccessfulBet: () => trace.push("mark") },
    "@/stores/account/balanceRefresh": { refreshAccountBalance: async () => trace.push("balance") },
    "@/stores/betting/arbOrderBind": { refreshOrderListAfterBind: () => trace.push("refresh") },
    "@/stores/messageStore": { useMessageStore: () => ({ delayMessage: () => trace.push("delay") }) },
    "@/stores/userStore": { useUserStore: () => ({ userId: "owner" }) },
    "@changmen/shared/pm_submission": { pmSubmissionFromResult: () => undefined },
    "@changmen/venue-adapter/polymarket": { pmSubmitScope: () => "owner:wallet" },
    "@/api/client": { getAuthSessionVersion: () => "session", isAuthSessionCurrent: () => true },
    "@/api/order": empty,
    "element-plus": { ElNotification: notify },
    "@/security/pmVault": { isVaultKeyProvider: () => false },
    "@/security/pmVault/retainedPmSession": { getRetainedPmPrivateKey: () => { throw new Error("prepared notification fixture must not enter wallet preflight"); } },
  };
  const notifications = load("client/web/src/shared/betNotification.ts", readSource("client/web/src/shared/betNotification.ts"), {
    "element-plus": modules["element-plus"],
    "./a8Notify": formatting,
  });
  modules["@/shared/betNotification"] = notifications;
  const api = load(file, text, modules, {
    Date: class extends Date { static now() { return 1000; } },
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    setTimeout: (_callback, delay) => { trace.push({ confirmation_timer: delay }); return 1; },
  });
  try {
    const account = { accountId: 2, provider: providerName };
    const result = await api.placeBet({ getPlatformName: () => providerName, findAccount: () => scenario.confirmation ? account : undefined }, account, { type: providerName, data: scenario.unprepared ? undefined : { prepared: true }, betMoney: 100, odds: 2, target: "Away", betId: "92", loseOrder: scenario.loseOrder, deferPostAcceptSettlement: scenario.deferPostAcceptSettlement }, 10, { requirePreparedQuote: true, linkId: 123 });
    for (let turn = 0; turn < 20; turn++) await Promise.resolve();
    return { trace, result: { success: result.success, link: result.link, pending: Boolean(result.pending), message: result.message }, queued: JSON.parse(storage.get("PENDING_VENUE_BET_CONFIRM") || "[]") };
  }
  catch (error) { return { trace, error: error.message }; }
}
