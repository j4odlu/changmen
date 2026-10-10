import fs from "node:fs";
import path from "node:path";
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { Currency, getExchange } from "@changmen/shared/currency";
import { resolveGtcFinancialOrder } from "../../../../db/rds/orderModes/gtc/pm_gtc_financial.js";
import { syncPmGtcSettledOrderFinancials } from "../../../../db/rds/orderModes/gtc/pm_gtc_settlement.js";

// [changmen 扩展] 默认只读；显式指定 owner 后才允许修复其 GTC 原单财务镜像。
const args=process.argv.slice(2);
const owner=args[args.indexOf("--owner")+1];
const apply=args.includes("--apply");
if (!args.includes("--owner") || !/^[0-9a-f-]{36}$/i.test(owner??""))
  throw new Error("Usage: node repair-pm-gtc-settlement.mjs --owner UUID [--apply]");
loadChangmenEnv();
process.env.DATABASE_RDS_TARGET??="public";
process.env.DATABASE_APPLICATION_NAME="repair-pm-gtc-settlement";
const { ensurePgPoolReady }=await import("@changmen/db");
const pool=await ensurePgPoolReady();
if(!pool)throw new Error("Database unavailable");
const client=await pool.connect();
const fx=getExchange(Currency.USDT);
const round4=n=>Math.round(n*10000)/10000;
const outputDir=path.resolve("output"); fs.mkdirSync(outputDir,{recursive:true});
const stamp=new Date().toISOString().replace(/[:.]/g,"-");
try {
  await client.query(apply?"BEGIN":"BEGIN READ ONLY");
  await client.query("SET LOCAL statement_timeout='20s'");
  const records=(await client.query("SELECT id,record FROM pm_gtc_executions WHERE owner=$1 ORDER BY id"+(apply?" FOR UPDATE":""),[owner])).rows;
  const rows=(await client.query(`SELECT o.* FROM orders o WHERE o.user_id=$1 AND o.provider='Polymarket'
    AND lower(coalesce(o.raw->>'pmSide','buy'))<>'sell'
    AND (o.raw->>'pmGtcExecutionId' IS NOT NULL OR EXISTS(
      SELECT 1 FROM pm_gtc_executions e WHERE e.owner=$1
      AND (e.record->'plan'->>'playerId')::bigint=o.player_id
      AND lower(o.order_id) IN (lower(e.record->>'orderId'),lower(e.record->'plan'->>'orderHash'))))
    ORDER BY o.id`+(apply?" FOR UPDATE OF o":""),[owner])).rows;
  const findings=[];
  for(const row of rows) {
    const raw=row.raw??{};
    const record=records.find(e=>Number(e.record.plan.playerId)===Number(row.player_id)
      && [e.record.orderId,e.record.plan.orderHash].some(id=>id&&id.toLowerCase()===row.order_id.toLowerCase())
      && (!raw.pmGtcExecutionId||raw.pmGtcExecutionId===e.id));
    const financial=record?resolveGtcFinancialOrder(record.record):undefined;
    const hasSale=Number(raw.pmAttributedSellShares)>0.0001 || ["partial","closed"].includes(String(raw.pmSellState).toLowerCase())
      || Number(raw.pmSellProceeds)>0 || Math.abs(Number(raw.pmRealizedPnlUsdc)||0)>0.0001;
    if(!financial||hasSale) {
      findings.push({id:row.id,orderId:row.order_id,skipped:hasSale?"selling ledger requires sale evidence":"no validated execution financials"});
      continue;
    }
    const status=String(row.status).toLowerCase();
    const expectedMoney=status==="win"?round4(financial.pmShares*fx-financial.betMoney)
      :["lose","lost"].includes(status)?round4(-financial.betMoney):Number(row.money);
    const expectedReward=status==="win"?round4(financial.pmShares*fx):0;
    const diff=Math.abs(Number(row.bet_money)-financial.betMoney)>0.000001
      || Math.abs((Number(raw.pmStakeUsdc)||0)-financial.pmStakeUsdc)>0.000001
      || Math.abs(Number(row.money)-expectedMoney)>0.000001
      || Math.abs((Number(raw.money)||0)-expectedMoney)>0.000001
      || (["win","lose","lost"].includes(status) && Math.abs((Number(raw.reward)||0)-expectedReward)>0.000001);
    findings.push({id:row.id,orderId:row.order_id,link:row.link,executionId:record.id,status:row.status,
      beforeCost:Number(row.bet_money),expectedCost:financial.betMoney,beforeMoney:Number(row.money),expectedMoney,needsRepair:diff});
  }
  const candidates=findings.filter(f=>f.needsRepair);
  if(apply&&candidates.length) {
    // Durable local rollback evidence is written before any order changes.
    fs.writeFileSync(path.join(outputDir,`gtc-financial-backup-${stamp}.json`),JSON.stringify({owner,rows:rows.filter(r=>candidates.some(c=>c.id===r.id))},null,2),{flag:"wx"});
    for(const f of candidates) {
      const e=records.find(r=>r.id===f.executionId); const financial=resolveGtcFinancialOrder(e.record);
      await client.query(`UPDATE orders SET bet_money=$3,
        raw=raw||jsonb_build_object('pmGtcExecutionId',$4::text,'betMoney',$3::float8,'pmStakeUsdc',$5::float8,
          'pmGtcBuyCost',$5::float8,'pmGtcBuyShares',$6::float8,'pmShares',$6::float8,'pmFeeUsdc',$7::float8)
        WHERE id=$1 AND user_id=$2`,[f.id,owner,financial.betMoney,e.id,financial.pmStakeUsdc,financial.pmShares,financial.pmFeeUsdc]);
      await syncPmGtcSettledOrderFinancials(client,owner,e.record.plan.playerId,f.orderId,e.id);
      const actual=(await client.query("SELECT bet_money,money,raw->>'money' AS raw_money FROM orders WHERE id=$1 AND user_id=$2",[f.id,owner])).rows[0];
      if(Math.abs(Number(actual.money)-f.expectedMoney)>0.000001||Math.abs(Number(actual.raw_money)-f.expectedMoney)>0.000001)
        throw new Error(`Financial verification failed for ${f.orderId}`);
    }
  }
  await client.query(apply?"COMMIT":"ROLLBACK");
  const result={owner,apply,checkedAt:new Date().toISOString(),executions:records.length,ordersChecked:rows.length,
    mismatches:candidates.length,repaired:apply?candidates.length:0,findings};
  const report=path.join(outputDir,`gtc-financial-${apply?"repair":"audit"}-${stamp}.json`);
  fs.writeFileSync(report,JSON.stringify(result,null,2));
  console.log(JSON.stringify({...result,report},null,2));
} catch(error) {await client.query("ROLLBACK");throw error;}
finally {client.release();await pool.end();}
