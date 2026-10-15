// [changmen 扩展] 精确登记客户端 GTC 状态/结果同步增量；两个原 FOK 基线保持不变。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { restoreGtcFormWireSource } from "./gtc-form-wire-boundary.mjs";
export const gtcClientStateHashes = Object.freeze({
  "client/web/src/stores/account/gtcCounterpartSync.ts": "bfcd0c550aa9d28bb1e031330734134a2865cd5428a4537559c0322f787f6387",
  "server/db/rds/orderModes/gtc/pm_gtc_client_import.js": "dffcc39636638f86ef1ef9f6134dd97de49818f86f60e8bcc0353b7e91381f70",
  "server/db/rds/orderModes/gtc/pm_gtc_result_identity.js": "37b362fc5b4d871cf8f8bef9797ca0980b5a4d08c405ace0bfd4217b36013ec2",
  "client/web/src/orderModes/gtc/api.ts": "ba95bf44bc43beb75bd3433b224a7cda361903080876ade10a12a4ea56309936",
  "client/web/src/orderModes/gtc/localPlan.ts": "5c96fb005339f8fa04e10020c4770920cab891d3c0ce35e86243c620b46d3b3d",
  "client/web/src/orderModes/gtc/localStore.ts": "f28e6ced197059ef681654bccb9f22ea37b6693591957dc4b8a90b30539d1fc4",
  "client/web/src/orderModes/gtc/confirmedResult.ts": "07d6f02cda34114b612c97a7896095dde76c02c17457c66356d4f50391d2a4b3",
  "client/web/src/orderModes/gtc/executionState.ts": "d0d44488a8b7519899712053b565a7a7b711dc2587604e3b7d9cd3a099224855",
  "client/web/src/orderModes/gtc/recoveryApi.ts": "3b6ee0cc6c69c7d51fc43f411ca6119082c4fb4f13e17abe36d91210c0f5cf96",
  "client/web/src/orderModes/gtc/ordersApi.ts": "02bad46b5a6761e6ec6314c63a93cdb902bbe12fb4df4603b749ae7434c0db2b",
  "client/web/src/orderModes/gtc/executionProjection.ts": "5ec966ed127e0580454c526d5837300dae3fa117cfa215b8402593f6c032796e",
  "client/web/src/runtime/gtcOrderMonitor/counterpart.ts": "7343e87e61a183543c2384fda66dae90edc8c2b4bfafd2ec0328eb66f474bbe0",
  "client/web/src/runtime/gtcOrderMonitor/localOrders.ts": "a291626e811a27805dcd8ccf47cfcd74e9e5ebaa5caeb89fa82a17e53efbaa1c",
  "client/web/src/runtime/gtcOrderMonitor/runtime.ts": "7828e90f2d27721654222b9deb134f23d18eda852acee5fb8ee61a9cca2554ed",
  "client/web/src/stores/account/gtcOrderSync.ts": "203ce1d549f32a0fcfeb96abe428d163de707e24fcda47f0ddcf2e5593f32021",
  "packages/shared/pm_gtc_result.ts": "d849be187eef404c04d103fb35153b4f1979b25d544b58703a3565ebc90efe68",
  "server/db/rds/orderModes/gtc/pm_gtc_results.js": "b0340ad0f78e83b63ab8a89f7a8fdd3d06c77dfcad0442566e8630c394a38003",
  "server/backend/core/orderModes/gtc/results.js": "66268478da32a310217aab4da0bd343879ba9c94a2755bdb202b511071515b8c",
  "server/backend/core/orderModes/gtc/handler.js": "3345d18721f30b49b768be9391874cb3c4ed19b576f86cc54a719facf7f18676",
  "server/backend/core/orderModes/gtc/orders.js": "2c595c3daf2daa0c90c443bf64774986969146dd550e110e0676351c3a1432fc",
});
export function verifyGtcClientStateSource(file, source) {
  const expected = gtcClientStateHashes[file];
  assert(expected, `${file}: registered GTC client state source`);
  source = restoreGtcFormWireSource(file, source);
  assert.equal(createHash("sha256").update(source.replaceAll("\r\n", "\n")).digest("hex"), expected,
    `${file}: complete reviewed GTC client state and result synchronization module`);
}
export function verifyGtcClientStateSources(readSource) {
  for (const file of Object.keys(gtcClientStateHashes)) verifyGtcClientStateSource(file, readSource(file));
}
export function restoreGtcClientStateSource(file, source, readSource, replaceExact) {
  if (file === "server/db/rds/orderModes/gtc/pm_gtc_orders_store.js" && source.includes("readGtcResultIdentity")) {
    verifyGtcClientStateSource("server/db/rds/orderModes/gtc/pm_gtc_result_identity.js", readSource("server/db/rds/orderModes/gtc/pm_gtc_result_identity.js"));
    source = replaceExact(source, 'import { readGtcResultIdentity } from "./pm_gtc_result_identity.js";');
    return replaceExact(source, `if (await readGtcResultIdentity(client, row)) {
      const parent = String(row.raw.pmBuyOrderId ?? row.order_id).toLowerCase();
      originals.set(\`\${row.user_id}:\${row.player_id}:\${parent}\`, { owner: row.user_id, player: row.player_id, order: parent, execution: row.raw.pmGtcExecutionId });
      continue;
    }`);
  }
  if (file === "server/db/index.js" && source.includes("savePmGtcConfirmedResult")) {
    verifyGtcClientStateSource("server/db/rds/orderModes/gtc/pm_gtc_results.js", readSource("server/db/rds/orderModes/gtc/pm_gtc_results.js"));
    source = replaceExact(source, 'export { savePmGtcConfirmedResult } from "./rds/orderModes/gtc/pm_gtc_results.js";');
    verifyGtcClientStateSource("server/db/rds/orderModes/gtc/pm_gtc_client_import.js", readSource("server/db/rds/orderModes/gtc/pm_gtc_client_import.js"));
    source = replaceExact(source, 'export { listPmGtcClientImport } from "./rds/orderModes/gtc/pm_gtc_client_import.js";');
    return replaceExact(source, 'export { resolveGtcFinancialOrder } from "./rds/orderModes/gtc/pm_gtc_financial.js";');
  }
  if (file === "server/backend/core/orderModes/orderMetadata.js" && source.includes("pmGtcResultRevision")) {
    source = replaceExact(source, '["pmGtcExecutionId", "pmGtcRevision", "pmGtcBuyShares", "pmGtcBuyCost", "pmGtcOrderSnapshot", "pmGtcResultRevision", "pmGtcConfirmedFills"]', '["pmGtcExecutionId", "pmGtcRevision", "pmGtcBuyShares", "pmGtcBuyCost", "pmGtcOrderSnapshot"]');
    return replaceExact(source, '["pmGtcRevision", "pmGtcBuyShares", "pmGtcBuyCost", "pmGtcOrderSnapshot", "pmGtcResultRevision", "pmGtcConfirmedFills"]', '["pmGtcRevision", "pmGtcBuyShares", "pmGtcBuyCost", "pmGtcOrderSnapshot"]');
  }
  if (file !== "client/web/src/api/order.ts" || !source.includes("registerOrderSyncProjection")) return source;
  for (const helper of ["client/web/src/stores/account/gtcOrderSync.ts", "client/web/src/stores/account/gtcCounterpartSync.ts", "client/web/src/orderModes/gtc/executionProjection.ts"])
    verifyGtcClientStateSource(helper, readSource(helper));
  source = replaceExact(source, `let orderSyncProjection: ((account: PlatformAccount, orders: VenueOrder[]) => VenueOrder[] | Promise<VenueOrder[]>) | undefined;
    export function registerOrderSyncProjection(project: NonNullable<typeof orderSyncProjection>): () => void {
      orderSyncProjection = project;
      return () => { if (orderSyncProjection === project) orderSyncProjection = undefined; };
    }`);
  return replaceExact(source, "orders = await (orderSyncProjection?.(account, orders) ?? orders);");
}
