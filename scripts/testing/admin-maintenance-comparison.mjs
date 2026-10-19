// [changmen 扩展] Native comparison of the original complete report and the extracted data port.
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {fileURLToPath} from 'node:url';
import {ADMIN_MAINTENANCE_ISOLATION as record} from '../verification/admin-maintenance-isolation.mjs';
const root=new URL('../../',import.meta.url);
const poolUrl=new URL('server/db/pg_pool.js',root).href;
const relationUrl=new URL('server/db/rds/native_orders.js',root).href;
const stub=`export {financialOrdersRelation} from ${JSON.stringify(relationUrl)};
export async function ensurePgPoolReady(){globalThis.__adminComparison.ready++;if(globalThis.__adminComparison.readyError)throw Error('ready failed');}
export function getPgPool(){globalThis.__adminComparison.pools++;return globalThis.__adminComparison.unavailable?null:{query:async(...args)=>{const c=globalThis.__adminComparison;c.queries.push(args);return c.query(...args);}};}`;
const stubUrl='data:text/javascript;base64,'+Buffer.from(stub).toString('base64');
registerHooks({resolve(spec,context,next){
 if(spec==='@changmen/db')return {url:stubUrl,shortCircuit:true};
 const resolved=next(spec,context);return resolved.url===poolUrl?{url:stubUrl,shortCircuit:true}:resolved;
}});
const old=await import('data:text/javascript;base64,'+Buffer.from(record.before).toString('base64'));
const current=await import(new URL(record.file,root));
const summarizeError=error=>({name:error.name,message:error.message});
export async function compareAdminMaintenance(query,{unavailable=false,readyError=false}={}){
 const results=[];
 for(const name of ['listSharedVenueAccounts','listDuplicateOrderIds','getAdminMaintenanceReport']){
  const run=async module=>{
   const state={ready:0,pools:0,queries:[],query,unavailable,readyError};globalThis.__adminComparison=state;
   const now=Date.now;Date.now=()=>1792440000000;
   let value,error;
   try{value=await module[name]();}catch(caught){error=summarizeError(caught);}finally{Date.now=now;}
   return {value,error,ready:state.ready,pools:state.pools,queries:state.queries};
  };
  const previous=await run(old),next=await run(current);
  assert.deepEqual(next,previous,name+': SQL, query order, readiness, errors and complete report must remain equal');
  results.push({name,...next});
 }
 return results;
}
export const comparisonRoot=fileURLToPath(root);
