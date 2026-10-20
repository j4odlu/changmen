import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accepted, facts } from "../../scripts/migrations/pm-gtc-orders/integration/fixtures.mjs";
import { applyGtcCommand } from "@changmen/shared/pm_gtc";
import { historicalMinimal, historicalCompatibility } from "../../scripts/verification/historical-order-storage.mjs";
const { minimalClientOrder, minimalFinancialDeletionSql, minimalFinancialSql, minimalGtcSnapshot, minimalHookRow, persistMinimalGtcOrder, pmOrdersMinimalEnabled, preparePmOrdersMinimal, pmOrdersMinimalProjectionWritesEnabled } = historicalMinimal;
const { DELETE_FINANCIAL_ORDERS_SQL } = historicalCompatibility;
import fs from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

beforeEach(()=>{vi.stubEnv("PM_ORDERS_MINIMAL","0");vi.stubEnv("ORDERS_EXECUTION_COMPAT","0");vi.stubEnv("PM_ORDERS_MINIMAL_PROJECTION_WRITE","");});
afterEach(()=>vi.unstubAllEnvs());
async function enable(){vi.stubEnv("PM_ORDERS_MINIMAL","1");await preparePmOrdersMinimal({query:async()=>({rows:[{valid:true}]})});}
describe("GTC minimal order isolation",()=>{
  it("disabled mode performs no validation or persistence",async()=>{
    const client={query:vi.fn()};await preparePmOrdersMinimal(client);await persistMinimalGtcOrder(client,accepted());expect(client.query).not.toHaveBeenCalled();
  });
  it.each(["yes","true","2"])("rejects invalid flag %s",value=>{vi.stubEnv("PM_ORDERS_MINIMAL",value);expect(pmOrdersMinimalEnabled).toThrow();});
  it("rejects legacy compatibility together with minimal mode",async()=>{vi.stubEnv("PM_ORDERS_MINIMAL","1");vi.stubEnv("ORDERS_EXECUTION_COMPAT","1");await expect(preparePmOrdersMinimal({})).rejects.toThrow("同时");});
  it("failed schema cannot retain readiness from another pool",async()=>{await enable();await expect(preparePmOrdersMinimal({query:async()=>({rows:[{valid:false}]})})).rejects.toThrow();expect(pmOrdersMinimalEnabled).toThrow("启动验证");});
  it("does not persist during the original first-order window",async()=>{await enable();const client={query:vi.fn()};await persistMinimalGtcOrder(client,accepted());expect(client.query).not.toHaveBeenCalled();});
  it.each(["prepared","unknown","rejected","not_attempted"])("cannot invent accepted order for %s",submit=>{const row={...accepted(),submit};expect(minimalGtcSnapshot(row,1)).toBeNull();});
  it("keeps unknown fills/fees unknown without copying control or plan",()=>{const view=minimalGtcSnapshot(accepted(),10);expect(view.matchedShares).toBeNull();expect(view.buyFinancial).toBeNull();for(const key of ["plan","fills","pmAuthorized","counted","other","walletKey"])expect(view).not.toHaveProperty(key);});
  it("preserves validated financial values without recalculation",()=>{const row=applyGtcCommand(accepted(),facts(),Date.now());row.financialOrder=facts().financialOrder;expect(minimalGtcSnapshot(row,1).buyFinancial).toEqual(row.financialOrder);});
  it("hook output excludes new columns with no changes to old fields",()=>{expect(minimalHookRow({id:"1",raw:{a:1},pm_order_mode:"GTC",pm_order_snapshot:{}})).toEqual({id:"1",raw:{a:1}});});
  it("FOK/non-PM DTO objects remain identical when disabled",()=>{const dto={BetMoney:1};expect(minimalClientOrder({provider:"Polymarket",pm_order_mode:"FOK"},dto)).toBe(dto);});
  it("unmarked FOK and other venue DTOs remain identical when enabled",async()=>{await enable();const dto={BetMoney:1};expect(minimalClientOrder({provider:"Polymarket"},dto)).toBe(dto);expect(minimalClientOrder({provider:"RAY",pm_order_mode:"GTC"},dto)).toBe(dto);});
  it("nonfinancial accepted order keeps DisplayOnly protections and unknown amounts",async()=>{await enable();const row=accepted();const dto=minimalClientOrder({provider:"Polymarket",pm_order_mode:"GTC",financial_ready:false,execution_id:row.id,pm_order_snapshot:minimalGtcSnapshot(row,1)},{BetMoney:0,Odds:0,Money:0});expect(dto.DisplayOnly).toBe(true);expect(dto.BetMoney).toBeUndefined();expect(dto.Odds).toBeUndefined();expect(dto.Money).toBeUndefined();});
  it("disabled deletion retains the exact published SQL",()=>{expect(minimalFinancialDeletionSql(DELETE_FINANCIAL_ORDERS_SQL)).toBe(DELETE_FINANCIAL_ORDERS_SQL);});
  it("paused projections retain minimal financial compatibility without writing a projection",async()=>{await enable();vi.stubEnv("PM_ORDERS_MINIMAL_PROJECTION_WRITE","0");const client={query:vi.fn()};const s={...accepted(),decision:"closed"};await persistMinimalGtcOrder(client,s);expect(client.query).not.toHaveBeenCalled();expect(pmOrdersMinimalEnabled()).toBe(true);expect(pmOrdersMinimalProjectionWritesEnabled()).toBe(false);expect(minimalFinancialDeletionSql(DELETE_FINANCIAL_ORDERS_SQL)).not.toBe(DELETE_FINANCIAL_ORDERS_SQL);});
  it.each(["false","yes","2"])("activation rejects invalid projection flag %s",async value=>{vi.stubEnv("PM_ORDERS_MINIMAL","1");vi.stubEnv("PM_ORDERS_MINIMAL_PROJECTION_WRITE",value);const pool={query:vi.fn()};await expect(preparePmOrdersMinimal(pool)).rejects.toThrow("PROJECTION_WRITE");expect(pool.query).not.toHaveBeenCalled();});
  it("minimal deletion rejects a changed target boundary",async()=>{await enable();expect(()=>minimalFinancialDeletionSql(DELETE_FINANCIAL_ORDERS_SQL.replace("SELECT id, execution_id", "SELECT id"))).toThrow("删除边界");});
  it.each([
    [true,true,false,"Return"], [false,true,false,"None"], [true,false,false,"None"], [true,true,true,"None"],
  ])("zero terminal display preserves complete=%s terminal=%s error=%s",async(complete,terminal,hasError,status)=>{
    await enable();const s=accepted(),view={...minimalGtcSnapshot(s,1),matchedShares:"0",complete,terminal,hasError};
    const dto=minimalClientOrder({provider:"Polymarket",pm_order_mode:"GTC",financial_ready:false,execution_id:s.id,pm_order_snapshot:view},{Status:"None"});
    expect(dto.Status).toBe(status);expect(dto.DisplayOnly).toBe(true);
  });
  it("old snapshots with unknown error state do not invent a return",async()=>{await enable();const s=accepted(),view={executionId:s.id,matchedShares:"0",terminal:true,complete:true};expect(minimalClientOrder({provider:"Polymarket",pm_order_mode:"GTC",financial_ready:false,execution_id:s.id,pm_order_snapshot:view},{Status:"None"}).Status).toBe("None");});
  it("financial transform fails closed if a replacement boundary is missing",()=>{
    const sql="SELECT order_id,execution_id,financial_ready FROM orders THEN (SELECT CASE WHEN execution_id= OR (execution_id IS NULL AND financial_ready) THEN order_id status,create_at,raw) 0,'None',$10,$11 ON CONFLICT(user_id,order_id,player_id) DO UPDATE SET";
    for(const boundary of ["SELECT order_id,execution_id,financial_ready FROM orders","THEN (SELECT CASE WHEN execution_id=","OR (execution_id IS NULL AND financial_ready) THEN order_id","ON CONFLICT(user_id,order_id,player_id) DO UPDATE SET"])
      expect(()=>minimalFinancialSql(sql.replace(boundary,"changed"))).toThrow("写入边界");
  });
  it.each(["9","0",null])("nonfinancial snapshot %s survives the actual published frontend projection",async shares=>{
    await enable();const s=accepted(),view={...minimalGtcSnapshot(s,1),matchedShares:shares};
    const dto=minimalClientOrder({provider:"Polymarket",pm_order_mode:"GTC",financial_ready:false,execution_id:s.id,pm_order_snapshot:view},
      {Type:"Polymarket",PlayerID:1,OrderID:"actual-order",PmSide:"buy",PmGtcExecutionId:s.id,PmGtcBuyShares:7,PmShares:7});
    const module={exports:{}};
    const source=fs.readFileSync(new URL("../../client/web/src/orderModes/gtc/executionProjection.ts",import.meta.url),"utf8");
    const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    new Function("require","module","exports",js)(createRequire(import.meta.url),module,module.exports);
    const projected=module.exports.partitionGtcOrderRows([dto]).gtc[0];
    expect(projected.PmShares).toBe(shares===null?undefined:Number(shares));expect(projected.DisplayOnly).toBe(true);
  });
});
