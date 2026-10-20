import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import { describe, expect, it } from "vitest";
import { gitSource, moduleTokens, replaceExact, verifyProtectedSource } from "./fok-exact-boundaries.mjs";
import { rayClientMonitorHashes, restoreRayOrderSyncSource, verifyRayClientMonitorSource } from "./ray-client-monitor-boundary.mjs";
import { restoreA8MakeupSource } from "./a8-makeup-boundary.mjs";
const read = withAdapterHistoryReader(file => readAdapterHistory(file, "utf8"));
describe("RAY client monitoring and normal synchronization remain separate", () => {
  it("normal order synchronization retains its entire original implementation before the exact binding tail", () => {
    const file = "client/web/src/stores/account/venueOrders.ts";
    const corrected = restoreA8MakeupSource(file, read(file), replaceExact);
    expect(moduleTokens(restoreRayOrderSyncSource(file, corrected, read, replaceExact))).toEqual(moduleTokens(gitSource("2391dc9df446dcb7ed85030a3faca3696b0d0da7", file)));
    for (const base of ["219535c8", "75b1efac66625e5f2bc9884a965b244bfaf337ed"])
      expect(() => verifyProtectedSource(file, read(file), gitSource(base, file), read, target => gitSource(base, target))).not.toThrow();
    expect(() => restoreRayOrderSyncSource(file, read(file).replace("syncRayOrderBindings(account, orders)", "syncRayOrderBindings(account, [])"), read, replaceExact)).toThrow();
  });
  it.each(Object.keys(rayClientMonitorHashes))("rejects extra actions in the exact separated source: %s", (file) => {
    expect(verifyRayClientMonitorSource(file, read(file))).toBe(true);
    expect(() => verifyRayClientMonitorSource(file, read(file) + "\nvoid unexpectedTradingAction();\n")).toThrow();
  });
  it("the monitor has no order writer, persistent binding or sidebar refresh", () => {
    for (const file of ["runtime", "api", "localOrders"].map(name => `client/web/src/runtime/rayOrderMonitor/${name}.ts`))
      expect(read(file)).not.toMatch(/Client_SaveOrder|saveOrders\(|saveRayMonitorOrders|bindArbOrderId|fetchOrders\(|refreshOrderListAfterBind/);
  });
});
