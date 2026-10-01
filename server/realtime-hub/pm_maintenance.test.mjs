import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateStatusPage,
  flattenStatusComponents,
  normalizePmMaintenanceState,
  PM_STATUS_PAGE_URL,
  resolvePmMaintenanceConfig,
  startPmMaintenanceWatcher,
} from "./pm_maintenance.js";

const OPERATIONAL = { name: "Polymarket Web App", status: "OPERATIONAL" };

const flush = () => new Promise(r => setTimeout(r, 5));

test("channel constant matches client", async () => {
  const { PM_MAINTENANCE_CHANNEL } = await import("./channels.js");
  assert.equal(PM_MAINTENANCE_CHANNEL, "Polymarket:Maintenance");
  assert.equal(PM_STATUS_PAGE_URL, "https://status.polymarket.com");
});

test("flattenStatusComponents walks children", () => {
  const tree = [
    OPERATIONAL,
    {
      name: "Predictions",
      status: "OPERATIONAL",
      children: [{ name: "Predictions Trading API (CLOB)", status: "UNDERMAINTENANCE" }],
    },
  ];
  assert.deepEqual(flattenStatusComponents(tree), [
    { name: "Polymarket Web App", status: "OPERATIONAL" },
    { name: "Predictions", status: "OPERATIONAL" },
    { name: "Predictions Trading API (CLOB)", status: "UNDERMAINTENANCE" },
  ]);
  assert.deepEqual(flattenStatusComponents(null), []);
  assert.deepEqual(flattenStatusComponents("nope"), []);
});

test("evaluateStatusPage derives state", () => {
  assert.equal(evaluateStatusPage({ status: "UP" }, [OPERATIONAL]).state, "operational");
  assert.equal(evaluateStatusPage({ status: "UNDERMAINTENANCE" }, [OPERATIONAL]).state, "maintenance");
  assert.equal(
    evaluateStatusPage({ status: "UP" }, [{
      name: "Predictions",
      status: "OPERATIONAL",
      children: [{ name: "CLOB", status: "UNDERMAINTENANCE" }],
    }]).state,
    "maintenance",
  );
  const degraded = evaluateStatusPage({ status: "UP" }, [{ name: "CLOB", status: "DEGRADEDPERFORMANCE" }]);
  assert.equal(degraded.state, "incident");
  assert.deepEqual(degraded.affected, ["CLOB=DEGRADEDPERFORMANCE"]);
  assert.equal(evaluateStatusPage({ status: "HASISSUES" }, []).state, "incident");
  assert.equal(evaluateStatusPage({}, []).state, "operational");
});

test("normalizePmMaintenanceState", () => {
  assert.equal(normalizePmMaintenanceState("operational"), "operational");
  assert.equal(normalizePmMaintenanceState("maintenance"), "maintenance");
  assert.equal(normalizePmMaintenanceState("incident"), "incident");
  assert.equal(normalizePmMaintenanceState(""), "unknown");
  assert.equal(normalizePmMaintenanceState(undefined), "unknown");
});

test("resolvePmMaintenanceConfig env parsing", () => {
  assert.deepEqual(resolvePmMaintenanceConfig({}), { enabled: true, pollMs: 60_000, timeoutMs: 10_000 });
  assert.equal(resolvePmMaintenanceConfig({ PM_MAINTENANCE_WATCH: "0" }).enabled, false);
  assert.equal(resolvePmMaintenanceConfig({ PM_MAINTENANCE_WATCH: "off" }).enabled, false);
  assert.equal(resolvePmMaintenanceConfig({ PM_MAINTENANCE_WATCH: "false" }).enabled, false);
  assert.equal(resolvePmMaintenanceConfig({ PM_MAINTENANCE_WATCH: "1" }).enabled, true);
  assert.equal(resolvePmMaintenanceConfig({ PM_MAINTENANCE_POLL_MS: "5000" }).pollMs, 30_000);
  assert.equal(resolvePmMaintenanceConfig({ PM_MAINTENANCE_POLL_MS: "90000" }).pollMs, 90_000);
  assert.equal(resolvePmMaintenanceConfig({ PM_MAINTENANCE_TIMEOUT_MS: "5000" }).timeoutMs, 5000);
});

/**
 * @param {(url: unknown) => Promise<{ok: boolean; status: number; json: () => Promise<unknown>}>} fetchImpl
 */
function startHarness(fetchImpl) {
  /** @type {{ channel: string; message: any }[]} */
  const messages = [];
  /** @type {(() => void) | null} */
  let intervalFn = null;
  const stop = startPmMaintenanceWatcher({
    emit: (channel, message) => messages.push({ channel, message }),
    env: {},
    fetchImpl,
    setIntervalImpl: (fn) => {
      intervalFn = fn;
      return {};
    },
    clearIntervalImpl: () => {},
  });
  const tick = async () => {
    intervalFn?.();
    await flush();
    await flush();
  };
  return { messages, stop, tick };
}

const SUMMARY_UP = { page: { name: "Polymarket", status: "UP" } };
const COMPONENTS_OK = [OPERATIONAL];
const COMPONENTS_MAINT = [{ name: "Polymarket Web App", status: "UNDERMAINTENANCE" }];

function statusFetch(components) {
  return (url) => {
    if (String(url).includes("summary.json"))
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(SUMMARY_UP) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ components }) });
  };
}

test("watcher disabled by env", async () => {
  const messages = [];
  const stop = startPmMaintenanceWatcher({
    emit: (channel, message) => messages.push({ channel, message }),
    env: { PM_MAINTENANCE_WATCH: "0" },
    setIntervalImpl: () => ({}),
    clearIntervalImpl: () => {},
  });
  await flush();
  assert.equal(messages.length, 0);
  stop();
});

test("watcher emits operational after first poll", async () => {
  const { messages, stop } = startHarness(statusFetch(COMPONENTS_OK));
  await flush();
  await flush();
  assert.equal(messages.length >= 1, true);
  assert.equal(messages[0].channel, "Polymarket:Maintenance");
  assert.equal(messages[0].message.state, "operational");
  assert.equal(messages[0].message.source, PM_STATUS_PAGE_URL);
  stop();
});

test("watcher flips to maintenance only after consecutive readings", async () => {
  let components = COMPONENTS_OK;
  const dynamic = startHarness((url) => {
    if (String(url).includes("summary.json"))
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(SUMMARY_UP) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ components }) });
  });
  await flush();
  await flush();
  assert.equal(dynamic.messages[0].message.state, "operational");
  components = COMPONENTS_MAINT;
  await dynamic.tick();
  assert.equal(dynamic.messages.at(-1).message.state, "operational");
  await dynamic.tick();
  assert.equal(dynamic.messages.at(-1).message.state, "maintenance");
  dynamic.stop();
});

test("watcher enters unknown after repeated network failures", async () => {
  let fail = false;
  const { messages, stop, tick } = startHarness((url) => {
    if (fail)
      return Promise.reject(new Error("boom"));
    if (String(url).includes("summary.json"))
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(SUMMARY_UP) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ components: COMPONENTS_OK }) });
  });
  await flush();
  await flush();
  assert.equal(messages[0].message.state, "operational");
  fail = true;
  await tick();
  await tick();
  assert.equal(messages.at(-1).message.state, "operational");
  await tick();
  assert.equal(messages.at(-1).message.state, "unknown");
  assert.equal(messages.at(-1).message.error, "boom");
  const count = messages.length;
  await tick();
  assert.equal(messages.length, count + 1);
  assert.equal(messages.at(-1).message.state, "unknown");
  stop();
});

test("watcher reports errors even when no poll has succeeded", async () => {
  const { messages, stop, tick } = startHarness(() => Promise.reject(new Error("status page timeout")));
  await flush();
  assert.equal(messages[0].message.state, "unknown");
  assert.equal(messages[0].message.error, "status page timeout");
  await tick();
  assert.equal(messages.length, 2);
  stop();
});

test("stopped watcher does not publish an in-flight result", async () => {
  let resolveFetch;
  const pending = new Promise(resolve => { resolveFetch = resolve; });
  const { messages, stop } = startHarness(() => pending);
  stop();
  resolveFetch({ ok: true, status: 200, json: async () => ({ ...SUMMARY_UP, components: COMPONENTS_OK }) });
  await flush();
  assert.equal(messages.length, 0);
});
