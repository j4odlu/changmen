import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { BetOption } from "@changmen/client-core/models/betOption";
import { BetResult } from "@changmen/client-core/models/betResult";
import { pmSubmissionFromResult, validatePmSubmission } from "@changmen/shared/pm_submission";

export const originalPendingGateway = execFileSync("git", ["show",
  "ea73dc5d2c65ccf2c320ddb9a852228fb15da269:client/web/src/stores/account/betGateway.ts"],
{ encoding: "utf8", windowsHide: true }).replaceAll("\r\n", "\n");
if (createHash("sha256").update(originalPendingGateway).digest("hex") !== "c8bf69743608e949bb4241325be4369a9ebaaf3ea219b317282370c03d9dfd9e")
  throw new Error("Original pending gateway baseline changed");

export const pendingGroups = {
  pendingVenueConfirmationState: ["loadPendingVenueBetConfirmations", "pendingVenueAccountMatches", "persistPendingVenueBetConfirmations"],
  pendingVenueConfirmationRunner: ["notifyPendingVenueConfirm", "schedulePendingVenueBetConfirmation", "runPendingVenueBetConfirmation"],
  pendingVenueConfirmationRecovery: ["pausePendingVenueConfirmations", "resumePendingVenueConfirmations", "restoreStoredPendingPmOrders", "restoreStoredPendingPmAccount"],
  betGateway: ["ensureSharedVaultKeyForAccount", "checkBetting", "placeBet"],
};
export const pendingDir = path.resolve(import.meta.dirname, "..");
export const readPending = (name: string) => readFileSync(path.join(pendingDir, name + ".ts"), "utf8");

// Run the complete historical gateway and the real extracted modules in separate
// contexts. Only external effects are substituted; scheduling uses a deterministic
// clock so ordered storage writes, calls and remaining timers can be compared.
export function pendingHarness(original: boolean, provider = "Polymarket", stored?: string) {
  let now = 1_700_000_000_000, sequence = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const log: unknown[][] = [];
  const storage = new Map(stored === undefined ? [] : [["PENDING_VENUE_BET_CONFIRM", stored]]);
  const account = { accountId: 9, provider, token: "{}" } as any;
  const maker = "0x1111111111111111111111111111111111111111";
  const control = { session: "one", scope: "owner-wallet", outcome: "pending", restoreError: false,
    accounts: [account], attempts: [] as any[], rows: [] as any[], saveError: false,
    confirmWait: undefined as Promise<void> | undefined };
  const record = (kind: string, ...values: unknown[]) => log.push([kind, ...JSON.parse(JSON.stringify(values))]);
  const store = { get accounts() { return control.accounts; }, findAccount: (id: number) => control.accounts.find(a => a.accountId === id) };
  class ClockBetOption extends BetOption {
    constructor(...args: ConstructorParameters<typeof BetOption>) { super(...args); this.startTime = now; }
  }
  class ClockBetResult extends BetResult {
    constructor(...args: ConstructorParameters<typeof BetResult>) { super(...args); this.beginTime = now; }
  }
  const settle = async (_account: unknown, result: any, opts: unknown) => {
    record("confirm", result, opts);
    if (control.confirmWait) await control.confirmWait;
    if (control.outcome === "throw") throw new Error("offline");
    return { pendingConfirm: control.outcome === "pending", rejected: control.outcome === "reject",
      orders: control.outcome === "filled" ? [{ orderId: result.orderId, status: "none", pmShares: 20 }] : [] };
  };
  const ports: Record<string, any> = {
    "@changmen/client-core/models/betOption": { BetOption: ClockBetOption },
    "@changmen/client-core/models/betResult": { BetResult: ClockBetResult },
    "@changmen/shared/pm_submission": { pmSubmissionFromResult, validatePmSubmission },
    "@changmen/shared/account_multiply": { isPendingConfirmVenueProvider: (p: string) => ["Polymarket", "PredictFun"].includes(p) },
    "@changmen/venue-browser/adapter/polymarket": { pmSubmitScope: () => control.scope, pmSubmitMaker: () => maker, pmAccountSubmitAttempts: () => control.attempts },
    "@/api/client": { getAuthSessionVersion: () => control.session, isAuthSessionCurrent: (v: string) => v === control.session },
    "@/api/order": {
      getPendingPmOrders: async (id: number) => { record("restore", id); if (control.restoreError) throw new Error("offline"); return control.rows; },
      getPmSubmission: async (...args: unknown[]) => { record("submission", ...args); return control.rows[0]?.submission; },
      saveOrders: async (...args: unknown[]) => { record("save", ...args); if (control.saveError) throw new Error("offline"); },
    },
    "@/realtime/bettingEventPayload": { captureBettingEventPayload: (o: BetOption) => ({ provider: o.type, matchId: 1001, betId: 20, target: o.target, betMoney: o.betMoney, odds: o.odds }) },
    "@/realtime/publishBetting": { publishBettingEvent: async (...args: unknown[]) => { record("publish", ...args); } },
    "@/services/orderObservation": { observeOption: (...args: unknown[]) => { record("observe", ...args); } },
    "@/shared/betNotification": { showBetResultNotification: (...args: unknown[]) => { record("notify", ...args); } },
    "@/shared/orderSound": { playOrderSuccessSound: async (...args: unknown[]) => { record("sound", ...args); } },
    "@/stores/account/pmRejectOrder": { persistPolymarketExecutionReject: async (...args: unknown[]) => { record("reject", ...args); return true; } },
    "@/stores/betting/autoBet/confirmVenueBet": { confirmVenueBet: settle },
    "@/stores/betting/autoBet/arbLegSettle": { settleArbLegUntilTerminal: settle },
    "@/stores/betting/successMarkers": { markSuccessfulBet: (...args: unknown[]) => { record("mark", ...args); } },
    "@/stores/account/balanceRefresh": { refreshAccountBalance: async () => { record("balance"); } },
    "@/stores/betting/arbOrderBind": { refreshOrderListAfterBind: () => { record("sidebar"); } },
  };
  const context = vm.createContext({ console, Date: class extends Date { static now() { return now; } },
    setTimeout: (callback: () => void, delay: number) => { const id = ++sequence; timers.set(id, { at: now + delay, callback }); return id; },
    clearTimeout: (id: number) => timers.delete(id),
    sessionStorage: {
      getItem: (key: string) => { record("storage-read", key); return storage.get(key) ?? null; },
      setItem: (key: string, value: string) => { record("storage-write", key, JSON.parse(value)); storage.set(key, value); },
    },
  });
  const modules = new Map<string, { exports: any }>();
  function load(name: string, source = readPending(name)): any {
    const cached = modules.get(name);
    if (cached) return cached.exports;
    const module = { exports: {} }; modules.set(name, module);
    const require = (id: string) => id.startsWith("./pendingVenueConfirmation") ? load(id.slice(2)) : ports[id] ?? {};
    const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInContext(`(function(require, module, exports) {${js}\n})`, context)(require, module, module.exports);
    return module.exports;
  }
  const api = original ? load("original", originalPendingGateway + "\nexport { notifyPendingVenueConfirm };")
    : { ...load("pendingVenueConfirmationRunner"), ...load("pendingVenueConfirmationRecovery") };
  const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
  const tick = async (ms: number) => {
    await flush(); const end = now + ms;
    for (;;) {
      const entry = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!entry) break;
      timers.delete(entry[0]); now = entry[1].at; entry[1].callback(); await flush();
    }
    now = end; await flush();
  };
  const submission = { orderId: "hash-one", accountId: 9, makerAmount: "10000000", stakeUsdc: 10, submittedAt: now, makerAddress: maker };
  const notify = (write?: Promise<void>) => {
    const option = Object.assign(new BetOption(provider as any, "match", "condition", "token", 10, "Home", 2), { bet: { id: 20 }, diagnosticLinkId: 5 });
    const result = Object.assign(new BetResult(provider as any, true), { orderId: "hash-one", pending: true, pmSubmittedAt: now,
      request: { order: { side: "BUY", makerAmount: submission.makerAmount, maker } } });
    api.notifyPendingVenueConfirm(store, account, "account", "details", result, option, 3, write);
  };
  return { control, log, api, store, submission, notify, tick, flush,
    snapshot: () => JSON.parse(JSON.stringify({ log, tasks: storage.get("PENDING_VENUE_BET_CONFIRM"), timers: [...timers.values()].map(t => t.at).sort() })) };
}
