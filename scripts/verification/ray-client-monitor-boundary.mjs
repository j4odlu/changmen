// [changmen 扩展] 固定本次客户端监控职责拆分；仅还原正常同步中唯一的关联收尾增量。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { restoreRaySubmissionPreviewSource } from "./ray-submission-preview-boundary.mjs";

export const rayClientMonitorHashes = Object.freeze({
  "client/web/src/runtime/rayOrderMonitor/api.ts": "34dd070e398f583b9ea2e01200fd52438fc6d70b57256cd0714d0d1ab8a745d1",
  "client/web/src/runtime/rayOrderMonitor/contextStore.ts": "6840f4be01e95adeba330b41c99e75ef6b3263a81fbed25595696c131aa4cd0a",
  "client/web/src/runtime/rayOrderMonitor/contexts.ts": "cfe521677d73b6557ac2a01c3fbfeaaaf5e61ec36ed69f59a5fbcf0df7bd4596",
  "client/web/src/runtime/rayOrderMonitor/runtime.ts": "15bce493c0f09fc15350e3631c8d8a2a2ae49dccaa281ebfbf27d3fff8546148",
  "client/web/src/runtime/rayOrderMonitor/types.ts": "66904040d717b06ad64f240e0ace52ebf8457fdd2541517c83310ff56a9cb96d",
  "client/web/src/runtime/rayOrderMonitor/localOrders.ts": "61150ea31c1471dcba3368b6f62b70973e0367fc0ced7d82cd85d13c34f83aea",
  "client/web/src/stores/account/rayOrderBindings.ts": "3696d51c940bf97b477455007c001b2fa08754873a2ba194d487f2338b92b6fd",
  "client/web/src/orderModes/gtc/otherOrders.ts": "df493d7586cbf258de43aaf0356bf9ae724134b10fc8049e57ed64d6271a4a6f",
});
export function verifyRayClientMonitorSource(file, source) {
  source = restoreRaySubmissionPreviewSource(file, source);
  const expected = rayClientMonitorHashes[file];
  if (!expected)
    return false;
  assert.equal(createHash("sha256").update(source.replaceAll("\r\n", "\n")).digest("hex"), expected,
    `${file}: complete committed RAY monitor source with explicit client-only separation`);
  return true;
}
export function restoreRayOrderSyncSource(file, source, readSource, replaceExact) {
  if (file !== "client/web/src/stores/account/venueOrders.ts" || !source.includes("syncRayOrderBindings"))
    return source;
  const helper = "client/web/src/stores/account/rayOrderBindings.ts";
  verifyRayClientMonitorSource(helper, readSource(helper));
  return replaceExact(source, `if (account.provider === "RAY") {
    void import("./rayOrderBindings")
      .then(({ syncRayOrderBindings }) => syncRayOrderBindings(account, orders))
      .catch(error => console.error("[RAY] 订单关联同步失败", error));
  }`);
}
