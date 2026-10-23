import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { compileScript, parse } from "@vue/compiler-sfc";
import * as vue from "vue";
import { afterEach, expect, test, vi } from "vitest";
import type { AdminOrderLogEntry, AdminOrderLogLookup, AdminOrderLogOrder, AdminOrderRow } from "@/types/admin";
import type { OrderObservationEvent } from "@changmen/shared/order_observation";
import * as format from "@changmen/client-core/shared/format";
import * as observationView from "@changmen/shared/order_observation_view";
import * as observation from "@/shared/adminOrderObservation";
import * as diagnosis from "@/shared/adminOrderDiagnosis";
import * as segments from "@/shared/adminOrderLogSegments";
import * as money from "@/shared/adminOrderMoney";
import * as display from "./adminOrderLogDisplay";
import * as grouping from "./adminOrderLogGrouping";
import * as presentation from "./useAdminOrderLogPresentation";
import { adminOrderComputedNames, originalAdminOrderDialog } from "./__tests__/adminOrderDialogOriginal";

const filename = resolve(process.cwd(), "src/components/admin/AdminOrderLogsDialog.vue");
function compile(source: string) {
  const script = compileScript(parse(source, { filename }).descriptor, { id: "admin-order-dialog-audit" });
  return ts.transpileModule(script.content, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
}
const before = compile(originalAdminOrderDialog), after = compile(readFileSync(filename, "utf8"));
type ExecutionLookup = { userId: string; linkId?: number; executionId?: string; attemptId?: string; eventId?: string };
type State = ReturnType<typeof presentation.useAdminOrderLogPresentation> & Pick<typeof display,
  "fmtTime" | "fmtClock" | "fmtMoney" | "orderMoneyCny" | "orderStakeCny" | "orderStakeLabel" | "reduceEvents" | "logDetailParts" | "statusBadgeClass" | "kindClass" | "pnlClass" | "attemptDividerLabel" | "legOrderAttempts" | "legProfit"> & {
  visible: vue.Ref<boolean>; loading: vue.Ref<boolean>; error: vue.Ref<string>; title: vue.Ref<string>;
  data: vue.Ref<AdminOrderLogLookup | null>; lookupRows: vue.Ref<AdminOrderRow[]>;
  expanded: vue.Ref<boolean>; legacyDetailed: vue.Ref<boolean>; executionLookup: vue.Ref<ExecutionLookup | null>;
  open: (rows: AdminOrderRow[]) => Promise<void>;
  openExecution: (lookup: ExecutionLookup) => Promise<void>;
  close: () => void; expandLookup: () => Promise<void>; copyReport: () => Promise<void>;
};
const scopes: vue.EffectScope[] = [];
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); });
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function setup(old: boolean) {
  const trace: unknown[] = [];
  const api = vi.fn<(body: unknown) => Promise<AdminOrderLogLookup>>();
  const clipboard = vi.fn(async (text: string) => { trace.push(["clipboard", text]); });
  const modules: Record<string, unknown> = {
    vue, "@changmen/client-core/shared/format": format, "@changmen/shared/order_observation_view": observationView,
    "@/shared/adminOrderObservation": observation, "@/shared/adminOrderDiagnosis": diagnosis,
    "@/shared/adminOrderLogSegments": segments, "@/shared/adminOrderMoney": money,
    "./adminOrderLogDisplay": display, "./adminOrderLogGrouping": grouping, "./useAdminOrderLogPresentation": presentation,
    "./AdminOrderExecutionRecords.vue": { default: {} },
    "@/api/admin": { getAdminOrderLogs: (body: unknown) => { trace.push(["request", json(body)]); return api(body); } },
    "element-plus": { ElMessage: { success: (message: string) => trace.push(["success", message]), error: (message: string) => trace.push(["error", message]) } },
  };
  const exports: Record<string, unknown> = {};
  runInNewContext(old ? before : after, {
    exports, require: (spec: string) => {
      if (!(spec in modules)) throw new Error("Unexpected dialog dependency: " + spec);
      return modules[spec];
    }, console, Date, JSON, Error, Promise, structuredClone, navigator: { clipboard: { writeText: clipboard } },
  });
  const component = exports.default as { setup: (props: unknown, context: unknown) => State };
  let exposed: unknown;
  const scope = vue.effectScope(); scopes.push(scope);
  const state = scope.run(() => component.setup({}, { expose: (value: unknown) => { exposed = value; } }))!;
  return { state, api, clipboard, trace, exposed };
}
function view(state: State) {
  return json(Object.fromEntries(adminOrderComputedNames.filter(name => !["diagnosisContext", "orchestrationStartAt"].includes(name))
    .map(name => [name, vue.unref<unknown>(state[name as keyof State])])));
}
function ui(state: State) {
  return json({ visible: state.visible.value, loading: state.loading.value, error: state.error.value, title: state.title.value,
    data: state.data.value, rows: state.lookupRows.value, execution: state.executionLookup.value,
    expanded: state.expanded.value, legacyDetailed: state.legacyDetailed.value });
}
const at = 1_790_000_000_000;
function log(change: Partial<AdminOrderLogEntry> = {}): AdminOrderLogEntry {
  return { id: 1, createAt: at, title: "[OB](platform, player)", kind: "check", summary: "check Home@2", ...change };
}
function order(provider = "OB", status = "Pending", index = 0): AdminOrderLogOrder {
  return { orderId: "order-" + index, link: at, provider, playerId: index + 1, match: index === 2 ? "Other match" : "A vs B",
    bet: "Winner", item: index % 2 ? "Away" : "Home", odds: 2.05, betMoney: 10.25, money: index % 2 ? -10.5 : 12.5,
    status, createAt: at + index * 100, pfSide: index % 2 ? "sell" : "buy", pmSide: index % 2 ? "sell" : "buy",
    positionEvents: { sells: [{ id: "sell-" + index, proceeds: 3.2, shares: 4, pnl: 0.4 }] } };
}
function payload(provider = "OB", status = "Pending", mode = "legacy", direction = "explicit", truncated = false): AdminOrderLogLookup {
  const orders = [order(provider, status, 2), order(provider, status, 0), order("RAY", "Win", 1)];
  const logs: AdminOrderLogEntry[] = [];
  for (const current of orders) {
    const target = current.orderId === "order-1" ? "Away" : "Home";
    for (const [offset, kind] of [[0, "check"], [1, "bet"]] as const) logs.push(log({
      id: logs.length + 1, createAt: current.createAt + offset, kind, provider: current.provider, orderId: current.orderId, linkId: at,
      target: direction === "explicit" ? target : null,
      summary: direction === "unknown" ? "no side" : `placed ${target}@2`, success: kind === "bet" ? true : undefined,
      odds: 2.05, requestOdds: 2.1, betMoney: 10.25, requestAmount: 10.5,
    }));
  }
  logs.reverse();
  logs.push(log({ id: 20, createAt: at + 150, provider, summary: "orphan Away@2", target: "Away" }),
    log({ id: 21, createAt: at + 150, provider: "RAY", summary: "unknown orphan", target: null }),
    log({ id: 22, createAt: at + 200_000, linkId: at + 1, summary: "different round" }));
  const result: AdminOrderLogLookup = {
    user: { id: "user-one", userName: "user" }, anchor: { type: "link", value: at }, link: at, linkType: "套利", groupLabel: "套利 3 笔",
    logWindow: { fromMs: at - 30_000, toMs: at + 30_000 }, orders, logs,
    unrelatedLogs: [logs.at(-1)!, { ...logs.at(-1)! }, log({ id: 23, summary: "another unrelated" })],
    logStats: { total: 50, related: 8, unrelated: 2, truncated, limit: 1000 }, legacyLogsLoaded: true,
  };
  if (mode === "backend") result.legSections = ["Away", "Home", "Unknown"].map((side, index) => ({
    key: side, side, legIndex: index, label: side, provider,
    attempts: index > 1 ? [] : [{ key: "backend-" + index, order: orders[index]!, logs: [...logs],
      logSegments: [{ key: "segment", accountLabel: "original", provider, isMakeUp: false, logs: [...logs] }] }],
  }));
  if (mode === "direct" || mode === "gap") {
    const event: OrderObservationEvent = { version: 1, ownerUserId: "user-one", eventId: "event-one", kind: mode === "gap" ? "transport_gap" : "submission_result",
      occurredAt: at, sequence: 1, linkId: at, executionId: "execution-one", attemptId: "attempt-one", provider,
      accountId: 1, target: "Away", outcome: "accepted", odds: 2.05, amount: 10.25, currency: "USDC", source: "adapter_result" };
    result.observation = { status: "available", mode: "shadow", truncated, events: [event], issues: truncated ? ["events truncated"] : [],
      queues: [], attempts: [{ attemptId: "attempt-one", events: [event], findings: ["missing confirmation"], evidence: "client_reported" }] };
    result.diagnosticSource = mode === "direct" ? "events" : "legacy";
    result.legacyLogsLoaded = false;
  }
  return result;
}
const row = (linkId = at, userId = "user-one"): AdminOrderRow => ({ ...order(), id: 1, userId, playerId: 1, linkId, domain: "sports", sport: "football" });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

test("compiled setup keeps the exposed API and lazy empty/execution-only presentation", () => {
  const old = setup(true), next = setup(false);
  expect(Object.keys(next.exposed as object)).toEqual(["open", "openExecution"]);
  expect(view(next.state)).toEqual(view(old.state));
  for (const instance of [old, next]) { instance.state.executionLookup.value = { userId: "user-one" }; instance.state.data.value = { ...payload(), orders: [], logs: [] }; }
  expect(view(next.state)).toEqual(view(old.state));
  expect(next.state.diagnosisSummary.value.text).toContain("执行观察记录");
});

test("separate dialog instances keep their query data and labels independent", () => {
  const first = setup(false).state, second = setup(false).state;
  first.data.value = payload();
  expect(first.sortedOrders.value).toHaveLength(3); expect(second.sortedOrders.value).toHaveLength(0);
  const labels = (state: State) => (state as unknown as { kindLabel: Record<string, string> }).kindLabel;
  labels(first).bet = "first instance";
  expect(labels(second).bet).toBe("下注");
});

const cases: string[][] = [];
for (const provider of ["OB", "Polymarket", "PredictFun"]) for (const status of ["Pending", "Win", "Reject", "Return"])
  for (const mode of ["legacy", "backend", "direct", "gap"]) for (const side of ["explicit", "summary", "unknown"])
    for (const truncated of ["no", "yes"]) cases.push([provider, status, mode, side, truncated]);
test.each(cases)("compiled presentation matches the original: %s %s %s %s truncated=%s", (provider, status, mode, side, truncated) => {
  const old = setup(true), next = setup(false);
  const input = payload(provider, status, mode, side, truncated === "yes"), original = json(input);
  old.state.data.value = structuredClone(input); next.state.data.value = input;
  expect(view(next.state)).toEqual(view(old.state));
  expect(input).toEqual(original);
  // Replacing and editing the actual refs must update the returned computed values.
  for (const instance of [old, next]) {
    instance.state.data.value!.orders[0]!.money += 13;
    instance.state.data.value!.logs.push(log({ id: 99, target: "Away", orderId: "order-0", linkId: at }));
  }
  expect(view(next.state)).toEqual(view(old.state));
  for (const instance of [old, next]) instance.state.data.value = null;
  expect(view(next.state)).toEqual(view(old.state));
});

test.each(["empty", "one-sided", "same-time", "empty-backend", "missing-stats", "idless-logs"])("keeps grouping edge case %s", kind => {
  const data = payload();
  if (kind === "empty") { data.orders = []; data.logs = []; data.unrelatedLogs = []; }
  if (kind === "one-sided") { data.linkType = "单边"; data.groupLabel = "单边"; data.orders = [order()]; data.orders[0]!.link = -at; data.logs = [log({ target: "Away" })]; }
  if (kind === "same-time") { data.orders.forEach(value => { value.createAt = at; }); data.logs.forEach(value => { value.createAt = at; }); }
  if (kind === "empty-backend") data.legSections = [];
  if (kind === "missing-stats") delete data.logStats;
  if (kind === "idless-logs") { data.logs.forEach(value => { delete value.id; }); data.unrelatedLogs = [...data.logs, ...data.logs]; }
  const old = setup(true), next = setup(false);
  old.state.data.value = structuredClone(data); next.state.data.value = structuredClone(data);
  expect(view(next.state)).toEqual(view(old.state));
});

test("preserves display text, money, partial sells, retry labels and elapsed time", () => {
  function exercise(old: boolean) {
    const { state } = setup(old); state.data.value = payload("PredictFun");
    const orders = [order("PredictFun"), order("PredictFun", "Win", 1), order("Polymarket"), order("Polymarket", "Win", 1), order("OB")];
    return { times: [0, at].map(time => [state.fmtTime(time), state.fmtClock(time)]), money: [-10.5, 0, 11.9].map(state.fmtMoney),
      orders: orders.map(value => [state.orderMoneyCny(value), state.orderStakeCny(value), state.orderStakeLabel(value), state.reduceEvents(value)]),
      badges: ["Win", "LOSE", "Reject", "Pending", "None"].map(state.statusBadgeClass),
      kinds: ["check", "bet", "reject", "other"].map(state.kindClass), pnl: [-1, 0, 1].map(state.pnlClass),
      details: [log(), log({ odds: NaN, requestOdds: null, requestAmount: 0, matchedOrderId: "matched", relationReason: "exact", accountLabel: "acct" })].map(state.logDetailParts),
      legs: state.legColumns.value.map(leg => [state.legOrderAttempts(leg), state.legProfit(leg)]),
      retry: state.attemptDividerLabel({ key: "a", order: order("OB", "Reject"), logs: [] }, { key: "b", order: order(), logs: [] }),
      elapsed: [0, at + 250, at + 1000, at + 1234].map(state.fmtOrchestrationElapsed) };
  }
  expect(exercise(false)).toEqual(exercise(true));
});

test.each([0, at])("preserves request parameters and clipboard report for link %s", async link => {
  async function exercise(old: boolean) {
    const { state, api, trace } = setup(old); api.mockResolvedValue(payload());
    await state.open([]); expect(api).not.toHaveBeenCalled();
    await state.open([row(link)]); await state.copyReport();
    await state.expandLookup(); await state.expandLookup();
    return { state: ui(state), view: view(state), trace };
  }
  expect(await exercise(false)).toEqual(await exercise(true));
});

test.each(["legacy", "direct"])("preserves execution-only opening and %s report", async mode => {
  async function exercise(old: boolean) {
    const { state, api, trace } = setup(old); api.mockResolvedValue({ ...payload("Polymarket", "Pending", mode), orders: [] });
    const lookup = { userId: "user-one", executionId: "execution-one", attemptId: "attempt-one", eventId: "event-one" };
    await state.openExecution(lookup); lookup.executionId = "later-mutation";
    await state.copyReport(); await state.expandLookup();
    expect(state.executionLookup.value!.executionId).toBe("execution-one");
    return { state: ui(state), view: view(state), trace };
  }
  expect(await exercise(false)).toEqual(await exercise(true));
});

test.each([[false, false], [true, false], [false, true], [true, true]])("only the newest request can publish data/errors; older failure=%s older finishes first=%s", async (failure, olderFinishesFirst) => {
  async function exercise(old: boolean) {
    const { state, api, trace } = setup(old), first = deferred<AdminOrderLogLookup>(), second = deferred<AdminOrderLogLookup>();
    api.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const pendingFirst = state.open([row(at, "first")]), pendingSecond = state.openExecution({ userId: "second", executionId: "second-execution" });
    const during = ui(state);
    const finishFirst = async () => {
      if (failure) first.reject(new Error("old failure")); else first.resolve(payload("OB", "Reject"));
      await pendingFirst;
    };
    if (olderFinishesFirst) {
      await finishFirst(); expect(state.loading.value).toBe(true); expect(state.data.value).toBeNull();
    }
    second.resolve(payload("Polymarket", "Win", "direct")); await pendingSecond;
    const latest = ui(state);
    if (!olderFinishesFirst) await finishFirst();
    expect(ui(state)).toEqual(latest); expect(trace.some(value => Array.isArray(value) && value[0] === "error")).toBe(false);
    return { during, latest, view: view(state), trace };
  }
  expect(await exercise(false)).toEqual(await exercise(true));
});

test.each([false, true])("closing the actual dialog invalidates pending responses; failure=%s", async failure => {
  async function exercise(old: boolean) {
    const { state, api, trace } = setup(old), response = deferred<AdminOrderLogLookup>(); api.mockReturnValueOnce(response.promise);
    const pending = state.open([row()]); state.close();
    if (failure) response.reject(new Error("closed failure")); else response.resolve(payload());
    await pending;
    expect(state.visible.value).toBe(false); expect(state.loading.value).toBe(false); expect(state.data.value).toBeNull();
    return { state: ui(state), trace };
  }
  expect(await exercise(false)).toEqual(await exercise(true));
});

test("retains current failure and clipboard denial messages", async () => {
  async function exercise(old: boolean) {
    const { state, api, clipboard, trace } = setup(old); api.mockRejectedValueOnce(new Error("current failure"));
    await state.open([row()]); expect(state.error.value).toBe("current failure");
    api.mockResolvedValue(payload()); await state.open([row()]); clipboard.mockRejectedValueOnce(new Error("denied"));
    await state.copyReport(); return { state: ui(state), trace };
  }
  expect(await exercise(false)).toEqual(await exercise(true));
});
