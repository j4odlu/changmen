// [changmen 扩展] 仅用于离线历史验收；旧实现读取不可变 Git，不进入应用模块或部署依赖。
import assert from "node:assert/strict";
import vm from "node:vm";
import path from "node:path";
import ts from "typescript";
import * as contract from "@changmen/shared/pm_gtc";
import * as currency from "@changmen/shared/currency";
import * as links from "../../rds/order_link_filter.js";
import * as bounds from "../../rds/rds/time_bounds.js";
import * as common from "../../rds/rds/common.js";
import * as financial from "../../rds/rds/orderModes/gtc/pm_gtc_financial.js";
import * as snapshot from "../../rds/rds/orderModes/gtc/pm_gtc_order_snapshot.js";
import * as ledger from "../../rds/rds/orderModes/gtc/pm_gtc_ledger.js";
import { gitSource } from "./fok-exact-boundaries.mjs";
import { retirementBase } from "./gtc-compat-retirement.mjs";
const allowed = new Set(["server/db/rds/pm_orders_minimal.js", "server/db/rds/orders_execution_compat.js", "server/db/rds/orders_store.js", "server/db/rds/orderModes/read.js", ...["pm_gtc_store", "pm_gtc_orders_store", "pm_gtc_settlement"].map(name => `server/db/rds/orderModes/gtc/${name}.js`)]);
const cache = new Map();
export function loadHistoricalOrderStorage(file) {
  assert(allowed.has(file), "registered historical storage module required");
  if (cache.has(file)) return cache.get(file);
  const exports = {}; cache.set(file, exports);
  const source = gitSource(retirementBase, file);
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(js, { exports, process, Date, Map, Set, Buffer, console, structuredClone, require(id) {
    if (id === "@changmen/shared/pm_gtc") return contract;
    if (id === "@changmen/shared/currency") return currency;
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), id));
    if (allowed.has(target)) return loadHistoricalOrderStorage(target);
    if (target === "server/db/order_link_filter.js") return links;
    if (target === "server/db/rds/time_bounds.js") return bounds;
    if (target === "server/db/rds/common.js") return common;
    if (target.endsWith("/pm_gtc_financial.js")) return financial;
    if (target.endsWith("/pm_gtc_order_snapshot.js")) return snapshot;
    if (target.endsWith("/pm_gtc_ledger.js")) return ledger;
    throw Error(`unregistered historical storage dependency: ${id}`);
  } }, { filename: `${retirementBase}:${file}` });
  return exports;
}
export const historicalMinimal = loadHistoricalOrderStorage("server/db/rds/pm_orders_minimal.js");
export const historicalCompatibility = loadHistoricalOrderStorage("server/db/rds/orders_execution_compat.js");
