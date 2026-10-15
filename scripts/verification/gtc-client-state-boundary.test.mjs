import fs from "node:fs";
import { expect, it } from "vitest";
import { gitSource, moduleTokens, replaceExact, verifyProtectedSource } from "./fok-exact-boundaries.mjs";
import { gtcClientStateHashes, restoreGtcClientStateSource, verifyGtcClientStateSource } from "./gtc-client-state-boundary.mjs";
const read = path => fs.readFileSync(path, "utf8");
it.each([
  ["results.js", 'jsonField(body.result, "result")', "body.result"],
  ["results.js", 'jsonField(body.anchors, "anchors")', "body.anchors"],
  ["results.js", 'jsonField(body.origins, "origins")', "body.origins"],
  ["results.js", "const owned = await assertPlayerOwnedByUser(result.playerId, owner);", "const owned = { ok: true };"],
  ["handler.js", 'body.clientImport === "true"', "Boolean(body.clientImport)"],
])("rejects altered form decoding or ownership: %s / %s", (name, before, after) => {
  const file = `server/backend/core/orderModes/gtc/${name}`;
  expect(read(file)).toContain(before);
  expect(() => verifyGtcClientStateSource(file, read(file).replace(before, after))).toThrow();
});
it.each(Object.keys(gtcClientStateHashes))("requires the complete reviewed GTC client/results module %s", file => {
  expect(() => verifyGtcClientStateSource(file, read(file))).not.toThrow();
  expect(() => verifyGtcClientStateSource(file, read(file) + "\nvoid unexpectedTradingAction();")).toThrow("complete reviewed");
});
it("ordinary order API remains its original complete source after the two exact additions", () => {
  const file = "client/web/src/api/order.ts";
  expect(moduleTokens(restoreGtcClientStateSource(file, read(file), read, replaceExact))).toEqual(moduleTokens(gitSource("3a88e886ad897d0bf06ee81c2aa761f7ae194738", file)));
  for (const base of ["219535c8", "75b1efac66625e5f2bc9884a965b244bfaf337ed"]) {
    expect(() => verifyProtectedSource(file, read(file), gitSource(base, file), read, target => gitSource(base, target))).not.toThrow();
    expect(() => verifyProtectedSource(file, read(file) + "\nvoid unexpectedTradingAction();", gitSource(base, file), read, target => gitSource(base, target))).toThrow();
  }
  expect(() => restoreGtcClientStateSource(file, read(file).replace("(account, orders) ?? orders", "(account, []) ?? orders"), read, replaceExact)).toThrow();
});
it("monitors update local facts without saving results or refreshing the sidebar", () => {
  for (const name of ["runtime", "pm", "pmPolling", "counterpart", "localOrders"]) {
    const source = read(`client/web/src/runtime/gtcOrderMonitor/${name}.ts`);
    expect(source).not.toMatch(/Client_SaveOrder|Pm_GtcCommand|Pm_GtcCreate|Pm_GtcSyncResult|fetchOrders\(|refreshGtcOrders\(/);
  }
  const api = read("client/web/src/orderModes/gtc/api.ts");
  expect(api).not.toMatch(/post.*Pm_Gtc(?:Create|Command)/);
  expect(read("server/backend/core/orderModes/gtc/handler.js")).not.toMatch(/\b(?:createPmGtc|mutatePmGtc)\s*\(/);
});
