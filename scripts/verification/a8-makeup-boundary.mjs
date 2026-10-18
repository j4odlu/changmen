// [A8 可证实] 精确登记补单消费/次数/option 锚点/即时重试修正；固定 FOK 基线不变。
import fs from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { restorePmMakeupSettlementSource } from "./pm-makeup-settlement-boundary.mjs";

const registered = fs.readFileSync(new URL("./a8-makeup-increments.json", import.meta.url), "utf8").replaceAll("\r\n", "\n");
assert.equal(createHash("sha256").update(registered).digest("hex"), "6f5954a0bbd44b70a75d86f0adf04e05573d081e035b90bff76e49a0405fcf14", "exact A8 makeup corrections must remain fixed");
export const a8MakeupIncrements = JSON.parse(registered);

export function restoreA8MakeupSource(file, source, replaceExact) {
  // [A8 可证实] 仅还原保存失败仍返回场馆原结果的修正；完整模块继续核对两个既有固定基线。
  if (file === "client/web/src/stores/account/venueOrders.ts" && source.includes("fetchedOrders")) {
    source = replaceExact(source, "onFetchedOrders?: (orders: VenueOrder[]) => void,");
    source = replaceExact(source, "onFetchedOrders?.(orders);");
    source = replaceExact(source, "let fetchedOrders: VenueOrder[] | undefined;");
    source = replaceExact(source, "return await syncVenueOrders(account, opts, (orders) => { fetchedOrders = orders; });",
      "return await syncVenueOrders(account, opts);");
    source = replaceExact(source, "return fetchedOrders;", "return undefined;");
  }
  source = restorePmMakeupSettlementSource(file, source, replaceExact);
  const entry = a8MakeupIncrements[file];
  if (!entry || !source.includes(entry.marker))
    return source;
  for (const [current, original] of entry.changes)
    source = replaceExact(source, current, original);
  return source;
}
