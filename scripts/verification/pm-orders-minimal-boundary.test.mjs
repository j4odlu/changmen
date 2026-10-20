import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import { execFileSync } from "node:child_process";
import { describe,it,expect } from "vitest";
import { minimalPath,restoreMinimalOrdersSource } from "./pm-orders-minimal-boundary.mjs";
const files=["server/db/rds/orders_execution_compat.js","server/db/rds/orders_store.js","server/db/rds/orderModes/gtc/pm_gtc_store.js","server/backend/core/account/order_store.js","server/backend/core/account/order/dto.js","server/db/index.js","server/db/rds/orderModes/read.js"];
// [changmen 扩展] 验证最小字段历史发布包的接线；当前订单模块有额外独立保护。
const read=p=>execFileSync("git",["show",`3e5ed4f1:${p}`],{encoding:"utf8"}).replaceAll("\r\n","\n"),base=p=>execFileSync("git",["show",`313c19e8afc30d62b54363830974b6738eab84d8:${p}`],{encoding:"utf8"}).replaceAll("\r\n","\n");
describe("exact minimal order protection without new baseline",()=>{
 it.each(files)("%s restores entire already published module",file=>expect(restoreMinimalOrdersSource(file,read(file),read)).toBe(base(file)));
 it.each(files)("%s rejects tampering with the complete new module",file=>expect(()=>restoreMinimalOrdersSource(file,read(file),p=>p===minimalPath?read(p).replace('row.submit !== "accepted"','row.submit === "accepted"'):read(p))).toThrow("complete reviewed"));
 it("cannot remove the first-order guard",()=>{const file="server/db/rds/orderModes/gtc/pm_gtc_store.js";expect(()=>restoreMinimalOrdersSource(file,read(file).replace('row.decision === "closed" && ',""),read)).toThrow("exact minimal");});
 it("cannot append projection work to control commands",()=>{const file="server/db/rds/orderModes/gtc/pm_gtc_store.js";expect(()=>restoreMinimalOrdersSource(file,read(file).replace('command.kind === "facts"','command.kind !== "ack"'),read)).toThrow("exact minimal");});
 it("cannot broaden mode validation",()=>{const file=files[0];expect(()=>restoreMinimalOrdersSource(file,read(file),p=>p===minimalPath?read(p).replace('value !== "1"','value === "1"'):read(p))).toThrow();});
 it("unchanged modules remain byte-identical rather than being excluded",()=>{const p="packages/shared/pm_gtc.ts";expect(restoreMinimalOrdersSource(p,read(p),read)).toBe(base(p));});
 it("unapproved original SQL mutation survives restoration and fails full comparison",()=>{const p=files[0],mutated=read(p).replace('WHERE orders.financial_ready','WHERE true');expect(restoreMinimalOrdersSource(p,mutated,read)).not.toBe(base(p));});
 it("live HTTP fixture changes only timeout, not assertions or production code",()=>{const p="server/backend/core/integrations/polymarket/clob_proxy.test.mjs";expect(restoreMinimalOrdersSource(p,read(p),read)).toBe(base(p));expect(read("server/backend/core/integrations/polymarket/clob_proxy.js").replaceAll("\r\n","\n")).toBe(base("server/backend/core/integrations/polymarket/clob_proxy.js"));});
 it("rejects weakened live HTTP assertions",()=>{const p="server/backend/core/integrations/polymarket/clob_proxy.test.mjs";expect(restoreMinimalOrdersSource(p,read(p).replace("expect(result.status).toBe(200)","expect(result.status).toBe(500)"),read)).not.toBe(base(p));});
});

describe("minimal deletion exact protection",()=>{ it("rejects bypassing the new deletion qualifier",()=>{const p="server/db/rds/orders_store.js";expect(()=>restoreMinimalOrdersSource(p,read(p).replace("minimalFinancialDeletionSql(DELETE_FINANCIAL_ORDERS_SQL)","DELETE_FINANCIAL_ORDERS_SQL"),read)).toThrow("exact minimal");}); });

it("cannot bypass projection pause while preserving compatible reads",()=>{const p="server/db/rds/orders_store.js";expect(()=>restoreMinimalOrdersSource(p,read(p),f=>f===minimalPath?read(f).replace("!pmOrdersMinimalProjectionWritesEnabled()","!pmOrdersMinimalEnabled()"):read(f))).toThrow("complete reviewed");});
