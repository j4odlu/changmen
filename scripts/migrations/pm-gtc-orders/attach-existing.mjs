// [changmen 扩展] 已有财务订单的非权威控制副本。无环境读取、自动执行或 INSERT。
// 必须由调用者完成实际版本兼容、来源/目标预检及 schema 校验后传入专用 client。
import {jsonHash,CONTROL_COLUMNS} from './plan.mjs';

export const ATTACH_EXISTING_SQL=`UPDATE public.orders SET
 execution_kind=$2,execution_id=$3,execution_wallet_key=$4,
 execution_active=$5,execution_record=$6,execution_updated_at=$7
 WHERE id=$1 AND financial_ready=true
 AND execution_kind IS NULL AND execution_id IS NULL AND execution_wallet_key IS NULL
 AND execution_active IS NULL AND execution_record IS NULL AND execution_updated_at IS NULL
 RETURNING *`;
const business=row=>Object.fromEntries(Object.entries(row).filter(([key])=>!CONTROL_COLUMNS.includes(key)));
const sourceHash=row=>jsonHash({...row,updated_at:String(row.updated_at)});
const fail=(code)=>{const error=new Error(code);error.code=code;throw error;};
const same=(a,b)=>jsonHash(a)===jsonHash(b);

/** One short transaction per existing order, using the legacy execution lock.
 * Busy legacy work is skipped immediately; the source is never mutated.
 * No source drift, target drift, partial controls, insertion or financial promotion.
 */
export async function attachExistingControl(client,operation){
 if(operation.action!=='attach-control'||!operation.targetId||!operation.control||!operation.sourceHash||!operation.expectedTargetHash)fail('INVALID_ATTACH_OPERATION');
 try{
  await client.query("BEGIN; SET LOCAL lock_timeout='250ms'; SET LOCAL statement_timeout='3s'; SET LOCAL idle_in_transaction_session_timeout='5s'");
  const lock=(await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired',[operation.executionId])).rows[0];
  if(!lock.acquired)fail('EXECUTION_BUSY');
  const source=(await client.query('SELECT * FROM public.pm_gtc_executions WHERE id=$1 FOR SHARE NOWAIT',[operation.executionId])).rows[0];
  if(!source||sourceHash(source)!==operation.sourceHash)fail('SOURCE_CHANGED');
  const rows=(await client.query(`SELECT * FROM public.orders WHERE user_id=$1 AND player_id=$2
    AND lower(order_id)=lower($3) ORDER BY id FOR UPDATE NOWAIT`,[source.owner,String(source.record.plan.playerId),source.record.plan.orderHash])).rows;
  if(rows.length!==1||String(rows[0].id)!==String(operation.targetId))fail('TARGET_IDENTITY_CHANGED');
  const before=rows[0],control=operation.control;
  if(before.provider!=='Polymarket'||String(before.raw?.pmSide??'buy').toLowerCase()==='sell'||before.financial_ready!==true)fail('TARGET_NOT_EXISTING_FINANCIAL_BUY');
  if(jsonHash(before)!==operation.expectedTargetHash)fail('TARGET_CHANGED');
  if(CONTROL_COLUMNS.some(key=>before[key]!=null))fail('TARGET_CONTROL_NOT_EMPTY');
  const expected={execution_kind:'pm-gtc-v1',execution_id:source.id,execution_wallet_key:source.wallet_key,execution_active:source.active,execution_record:source.record,execution_updated_at:String(source.updated_at)};
  if(!same({...control,execution_updated_at:String(control.execution_updated_at)},expected))fail('SOURCE_CONTROL_MISMATCH');
  const result=await client.query(ATTACH_EXISTING_SQL,[String(before.id),control.execution_kind,control.execution_id,control.execution_wallet_key,control.execution_active,control.execution_record,String(control.execution_updated_at)]);
  if(result.rowCount!==1)fail('ATTACH_COMPARE_FAILED');
  const after=result.rows[0];
  if(!same(business(before),business(after)))fail('BUSINESS_FIELDS_CHANGED');
  const observed=Object.fromEntries(CONTROL_COLUMNS.map(key=>[key,key==='execution_updated_at'?String(after[key]):after[key]]));
  if(!same(observed,expected))fail('CONTROL_COPY_MISMATCH');
  const sourceAfter=(await client.query('SELECT * FROM public.pm_gtc_executions WHERE id=$1',[operation.executionId])).rows[0];
  if(!sourceAfter||sourceHash(sourceAfter)!==operation.sourceHash)fail('SOURCE_CHANGED_DURING_COPY');
  await client.query('COMMIT');
  return {executionId:source.id,targetId:String(before.id),oldFieldsHash:jsonHash(business(before)),controlRecordHash:jsonHash(source.record),sourceHash:operation.sourceHash,sourceUpdatedAt:String(source.updated_at),copied:true};
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
}
