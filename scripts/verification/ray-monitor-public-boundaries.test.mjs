// [changmen 扩展] 固定已提交迁移，负向验证公共入口和完整新模块，不能借迁移绕过原 FOK 模块检查。
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { gitSource, moduleTokens, replaceExact, verifyProtectedSource } from "./fok-exact-boundaries.mjs";
import { restoreRayBackendDispatch } from "./ray-backend-dispatch-boundary.mjs";
import { rayFrontendCommit, rayFrontendSources, restoreRayFinalizeSource, restoreRayProviderSource, verifyRayFrontendSources } from "./ray-frontend-boundary.mjs";

const read = file => fs.readFileSync(file, "utf8");
const writer = "server/backend/core/account/order_store.js";
const service = "server/backend/core/account/account_service.js";
describe("complete committed RAY migration preserves fixed public FOK modules", () => {
  it("requires all committed monitoring implementations", () => {
    expect(verifyRayFrontendSources(read).completeModules).toBe(13);
  });
  it.each(rayFrontendSources)("rejects any added action in %s", (file) => {
    expect(() => verifyRayFrontendSources(target => read(target) + (target === file ? "\nvoid unexpectedTradingAction();" : ""))).toThrow("complete committed RAY monitor source");
  });
  it("restores only the committed finalize registration rename", () => {
    const file = "client/web/src/stores/betting/autoBet/phases/finalizeArbBet.ts";
    expect(moduleTokens(restoreRayFinalizeSource(file, gitSource(rayFrontendCommit, file), replaceExact)))
      .toEqual(moduleTokens(gitSource(`${rayFrontendCommit}^`, file)));
  });
  it.each([writer, service])("restores the entire pre-migration module: %s", (file) => {
    expect(moduleTokens(restoreRayBackendDispatch(file, gitSource(rayFrontendCommit, file), replaceExact)))
      .toEqual(moduleTokens(gitSource(`${rayFrontendCommit}^`, file)));
  });
  it.each([
    [writer, "options?.rayMonitorOnly && incomingResolved.some", "incomingResolved.some"],
    [writer, "previous.provider !== \"RAY\"", "false"],
    [writer, "[\"win\", \"lose\", \"lost\", \"return\", \"reject\"]", "[\"win\"]"],
    [writer, "sb.patchRayMonitorOrders(rows)", "sb.upsertOrders(rows)"],
    [service, "body.rayMonitorOnly === true", "true"],
    [service, "listRayMonitorOrders(playerId, userId,", "listRayMonitorOrders(playerId, \"other-owner\","],
  ])("rejects altered RAY dispatch %s/%s", (file, before, after) => {
    const source = read(file); expect(source).toContain(before);
    expect(() => restoreRayBackendDispatch(file, source.replace(before, after), replaceExact)).toThrow();
  });
  it.each([writer, service])("keeps unregistered extra work visible to both FOK baselines: %s", (file) => {
    for (const base of ["219535c8", "75b1efac66625e5f2bc9884a965b244bfaf337ed"])
      expect(() => verifyProtectedSource(file, `${read(file)}\nvoid unexpectedTradingAction();`, gitSource(base, file), read, target => gitSource(base, target))).toThrow();
  });
  it("requires both the entire passive provider wrapper and its observation implementation", () => {
    const file = "client/web/src/runtime/providers.ts";
    expect(restoreRayProviderSource(file, read(file), read)).toBe(gitSource("75b1efac66625e5f2bc9884a965b244bfaf337ed", file));
    expect(() => restoreRayProviderSource(file, read(file).replace("return orders;", "return [];"), read)).toThrow();
    expect(() => restoreRayProviderSource(file, read(file), target => `${read(target)}\nvoid unexpectedTradingAction();`)).toThrow();
  });
});
