// [changmen 扩展] 独立运维工具；无 dotenv、业务 API、旧源写入或通知调用。
import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { historicalMinimal } from "../../verification/historical-order-storage.mjs";
const { minimalGtcSnapshot } = historicalMinimal;
import { resolveGtcFinancialOrder } from "../../../rds/rds/orderModes/gtc/pm_gtc_financial.js";

export const MAX_BATCH = 25;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const orderHash = /^0x[0-9a-f]{64}$/i;
const metadataKeys = ["execution_id","pm_order_mode","pm_order_snapshot"];
const fail = code => { const e = new Error(code); e.code = code; throw e; };
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k,canonical(value[k])]));
  if (typeof value === "number" && !Number.isFinite(value)) fail("NONFINITE_ARTIFACT");
  return value;
}
export const digest = value => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
export function seal(value) { return { ...value, digest:digest(value) }; }
export function verifyArtifact(value, kind) {
  if (!value || value.kind !== kind || value.version !== 1) fail("INVALID_ARTIFACT");
  const { digest:expected,...body } = value;
  if (!expected || expected !== digest(body)) fail("ARTIFACT_CHANGED");
  return body;
}
const meta = row => Object.fromEntries(metadataKeys.map(k => [k,row[k] ?? null]));
function knownProjection(view,id) {
  const keys=["version","executionId","revision","updatedAt","submit","orderStatus","matchedShares","remainingShares","complete","terminal","hasError","buyFinancial"];
  const financial=["pmShares","pmFillPrice","pmStakeUsdc","pmFeeUsdc","odds","betMoney"];
  return view && typeof view==="object" && !Array.isArray(view) && view.version===1 && view.executionId===id && Number.isSafeInteger(view.revision) && view.revision>=0
    && Object.keys(view).every(k=>keys.includes(k)) && (view.buyFinancial==null || typeof view.buyFinancial==="object" && !Array.isArray(view.buyFinancial)
      && Object.entries(view.buyFinancial).every(([k,v])=>financial.includes(k)&&typeof v==="number"&&Number.isFinite(v)&&v>=0));
}
const withoutMeta = row => Object.fromEntries(Object.entries(row).filter(([k]) => !metadataKeys.includes(k)));
const schemaSql = fs.readFileSync(new URL("schema.sql",import.meta.url),"utf8").replaceAll("\r\n","\n");
export const schemaDigest = createHash("sha256").update(schemaSql).digest("hex");
const schemaBody = schemaSql.slice(schemaSql.indexOf("\nBEGIN;\n")+8).replace(/COMMIT;\s*$/,"")
  .replace("SET LOCAL lock_timeout='2s';\nSET LOCAL statement_timeout='10s';\n","");
const functionBody = schemaSql.match(/AS \$\$([\s\S]*?)\$\$;/)?.[1];
if (!functionBody || !schemaSql.includes("\nBEGIN;\n") || !schemaSql.endsWith("COMMIT;\n")) fail("SCHEMA_WRAPPER_CHANGED");

export async function readTarget(client) {
  const row = (await client.query("SELECT current_database() AS database,current_user AS role,host(inet_server_addr()) AS address,inet_server_port() AS port")).rows[0];
  if (!row?.database || !row.role || !row.address || !row.port) fail("TARGET_IDENTITY_UNAVAILABLE");
  return row;
}
export function requireConsumers(attestation,target,phase) {
  if (!attestation || digest(attestation.target) !== digest(target) || attestation.allConsumersCompatible !== true
    || attestation.oldExecutionSource !== "pm_gtc_executions" || attestation.legacyFlag !== "0") fail("CONSUMERS_NOT_COMPATIBLE");
  if (phase === "install") {
    if (attestation.minimalFlag !== "0") fail("SCHEMA_INSTALL_REQUIRES_FLAGS_OFF");
  } else if (attestation.minimalFlag !== "1" || attestation.projectionWritesPaused !== true || attestation.financialFilteringRetained !== true) {
    fail("COMPATIBLE_READS_AND_PAUSED_PROJECTIONS_REQUIRED");
  }
}
async function transaction(client,readonly,work) {
  const deadline=performance.now()+3000;
  try {
    await client.query(readonly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
    await client.query("SET LOCAL lock_timeout='250ms'; SET LOCAL statement_timeout='3s'; SET LOCAL idle_in_transaction_session_timeout='3s'");
    const bounded={query:async(sql,args)=>{const remaining=Math.floor(deadline-performance.now());if(remaining<=0)fail("BATCH_DEADLINE");await client.query(`SET LOCAL statement_timeout='${remaining}ms'`);return client.query(sql,args);}};
    const result = await work(bounded);
    const remaining=Math.floor(deadline-performance.now());if(remaining<=0)fail("BATCH_DEADLINE");
    await client.query(`SET LOCAL statement_timeout='${remaining}ms'`);
    await client.query("COMMIT"); return result;
  } catch (error) { await client.query("ROLLBACK").catch(()=>{}); throw error; }
}
export async function validateSchema(client) {
  const legacy=(await client.query(`SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.orders'::regclass AND conname LIKE 'orders_execution_%'
    UNION ALL SELECT 1 FROM pg_trigger WHERE tgrelid='public.orders'::regclass AND tgname LIKE 'orders_execution_%'
    UNION ALL SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='orders' AND indexname LIKE 'orders_execution_%') AS present`)).rows[0];
  if(legacy?.present!==false)fail("LEGACY_FULL_SCHEMA_PRESENT");
  const definition=(await client.query("SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='validate_pm_orders_minimal_v1' AND p.pronargs=0")).rows;
  if (definition.length !== 1 || definition[0].prosrc !== functionBody) fail("SCHEMA_VALIDATOR_CHANGED");
  if ((await client.query("SELECT public.validate_pm_orders_minimal_v1() AS valid")).rows[0]?.valid !== true) fail("SCHEMA_NOT_COMPATIBLE");
}
async function catalog(client) {
  const columns=(await client.query("SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS required,pg_get_expr(d.adbin,d.adrelid) AS default FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='public.orders'::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum")).rows;
  const objects=(await client.query(`SELECT 'constraint' AS kind,conname AS name,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.orders'::regclass
    UNION ALL SELECT 'index',indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='orders'
    UNION ALL SELECT 'trigger',tgname,pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='public.orders'::regclass AND NOT tgisinternal
    ORDER BY kind,name`)).rows;
  const extras=(await client.query(`SELECT 'function' AS kind,p.proname AS name,p.prosrc AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('validate_pm_orders_minimal_v1','validate_orders_execution_schema_v1')
    UNION ALL SELECT 'view',viewname,definition FROM pg_views WHERE schemaname='public' AND viewname='orders_financial' ORDER BY kind,name`)).rows;
  return {columns,objects,extras};
}
export async function planSchema(client) {
  return transaction(client,true,async(client)=>{
    const target=await readTarget(client),before=await catalog(client);
    if (before.extras.some(o=>o.name==='validate_orders_execution_schema_v1') || before.objects.some(o=>o.name.startsWith("orders_execution_"))) fail("LEGACY_FULL_SCHEMA_PRESENT");
    const ready=before.columns.find(c=>c.name==='financial_ready'),execution=before.columns.find(c=>c.name==='execution_id');
    if (!ready || ready.type!=="boolean" || !ready.required || ready.default!=="true" || !execution || execution.type!=="uuid" || execution.required || execution.default!==null) fail("EXISTING_COLUMNS_NOT_COMPATIBLE");
    const any=before.columns.some(c=>["pm_order_mode","pm_order_snapshot"].includes(c.name)) || before.extras.length || before.objects.some(o=>o.name.startsWith("pm_orders_minimal_"));
    if (any) await validateSchema(client); // 部分/不兼容安装停止；不覆盖原对象。
    return seal({version:1,kind:"schema-plan",target,sqlDigest:schemaDigest,action:any?"already-installed":"install",before,beforeHash:digest(before)});
  });
}
async function persist(receipt,persistPrepared) {
  if (typeof persistPrepared !== "function") fail("DURABLE_RECEIPT_REQUIRED");
  await persistPrepared(receipt); return receipt;
}
export async function installSchema(client,plan,{attestation,persistPrepared}={}) {
  const body=verifyArtifact(plan,"schema-plan");
  if (body.sqlDigest !== schemaDigest) fail("SCHEMA_SOURCE_CHANGED");
  return transaction(client,false,async(client)=>{
    const target=await readTarget(client);if (digest(target)!==digest(body.target)) fail("TARGET_DATABASE_CHANGED");
    requireConsumers(attestation,target,"install");
    await client.query("LOCK TABLE public.orders IN ACCESS EXCLUSIVE MODE NOWAIT");
    if (digest(await catalog(client))!==body.beforeHash) fail("SCHEMA_CHANGED");
    if (body.action==="already-installed") {await validateSchema(client);return {status:"already-installed",target};}
    if (body.action!=="install") fail("INVALID_SCHEMA_ACTION");
    // 单条执行 DDL，函数体整体保留；每条都使用整批剩余时间，不能被 SQL 内 SET 覆盖。
    const start=schemaBody.indexOf("CREATE FUNCTION public.validate_pm_orders_minimal_v1()"),end=schemaBody.indexOf("END $$;",start)+7;
    if(start<0||end<7)fail("SCHEMA_FUNCTION_BOUNDARY_CHANGED");
    const statements=[...schemaBody.slice(0,start).split(/;\s*\n/).filter(s=>s.trim()),schemaBody.slice(start,end),schemaBody.slice(end).trim()];
    for(const sql of statements)await client.query(sql);
    await validateSchema(client);const after=await catalog(client);
    if (digest(after.columns.filter(c=>!["pm_order_mode","pm_order_snapshot"].includes(c.name)))!==digest(body.before.columns)
      || digest(after.objects.filter(o=>!o.name.startsWith("pm_orders_minimal_")))!==digest(body.before.objects)) fail("ORIGINAL_SCHEMA_CHANGED");
    return persist(seal({version:1,kind:"schema-receipt",batchId:randomUUID(),target,planDigest:plan.digest,beforeHash:body.beforeHash,afterHash:digest(after),sqlDigest:schemaDigest}),persistPrepared);
  });
}

function operation(source,targets,peers) {
  const r=source.record;
  if (!r || !uuid.test(source.id) || !uuid.test(source.owner) || r.id!==source.id || r.owner!==source.owner || r.walletKey!==source.wallet_key || source.active!==!r.released) fail("SOURCE_IDENTITY_INVALID");
  if (r.submit!=="accepted") return {skip:"NO_ACCEPTED_ORDER"};
  if (r.decision!=="closed") return {skip:"FIRST_ORDER_WINDOW_OPEN"};
  if (!Number.isSafeInteger(r.revision) || r.revision<0 || !Number.isSafeInteger(r.createdAt) || r.createdAt<=0 || !Number.isSafeInteger(r.plan?.playerId) || r.plan.playerId<=0
    || !orderHash.test(r.plan.orderHash) || typeof r.orderId!=="string" || r.orderId.toLowerCase()!==r.plan.orderHash.toLowerCase()
    || ["complete","terminal","released"].some(key=>typeof r[key]!=="boolean") || !r.fills || Array.isArray(r.fills)
    || !Number.isSafeInteger(Number(source.updated_at)) || Number(source.updated_at)<=0) fail("SOURCE_RECORD_INVALID");
  if (peers.filter(s=>s.owner===source.owner && String(s.record?.plan?.playerId)===String(r.plan.playerId) && s.record?.plan?.orderHash?.toLowerCase()===r.plan.orderHash.toLowerCase()).length!==1) fail("MULTIPLE_EXECUTIONS_FOR_ORIGINAL");
  const matches=targets.filter(t=>t.user_id===source.owner && String(t.player_id)===String(r.plan.playerId) && t.order_id.toLowerCase()===r.orderId.toLowerCase());
  if (matches.length>1) fail("AMBIGUOUS_ORIGINAL_CASE");
  const prior=matches[0];
  if (targets.some(t=>t.execution_id===source.id && t.id!==prior?.id)) fail("EXECUTION_BOUND_ELSEWHERE");
  if (prior && (prior.provider!=="Polymarket" || ![null,"GTC"].includes(prior.pm_order_mode) || (prior.execution_id && prior.execution_id!==source.id)
    || (prior.raw?.pmGtcExecutionId && prior.raw.pmGtcExecutionId!==source.id) || prior.raw?.pmSide==="sell")) fail("TARGET_IDENTITY_CONFLICT");
  if (prior?.pm_order_snapshot && (prior.pm_order_snapshot.executionId!==source.id || !Number.isSafeInteger(prior.pm_order_snapshot.revision) || prior.pm_order_snapshot.revision>r.revision)) fail("TARGET_VERSION_CONFLICT");
  if (prior?.pm_order_snapshot && !knownProjection(prior.pm_order_snapshot,source.id)) fail("TARGET_SNAPSHOT_SCHEMA_CONFLICT");
  const snapshot=minimalGtcSnapshot({...r,financialOrder:resolveGtcFinancialOrder(r)},Number(source.updated_at));
  if (!snapshot) fail("NO_VALID_SNAPSHOT");
  const metadata={execution_id:source.id,pm_order_mode:"GTC",pm_order_snapshot:snapshot};
  if (prior && digest(meta(prior))===digest(metadata)) return {skip:"ALREADY_CURRENT"};
  const insert={user_id:source.owner,player_id:r.plan.playerId,order_id:r.orderId,link:r.plan.linkId??null,provider:"Polymarket",match:r.plan.match??null,bet:r.plan.bet??null,item:r.plan.item??null,create_at:r.createdAt,
    raw:canonical({pmGtcExecutionId:source.id,pmSide:"buy",pmTokenId:r.plan.tokenId,pmConditionId:r.plan.conditionId,pmOrigin:"changmen"})};
  return {executionId:source.id,sourceHash:digest(source),identity:{owner:source.owner,playerId:r.plan.playerId,orderId:r.orderId},metadata,
    action:prior?"attach":"insert-pending",targetId:prior?.id??null,targetHash:prior?digest(prior):null,beforeMeta:prior?meta(prior):null,insert:prior?null:insert};
}
async function cohort(client,sources,lock=false) {
  const identities=sources.filter(s=>s.record?.plan && Number.isSafeInteger(s.record.plan.playerId) && orderHash.test(s.record.plan.orderHash)).map(s=>({owner:s.owner,player_id:s.record.plan.playerId,order_id:s.record.plan.orderHash.toLowerCase()}));
  if (!identities.length) return {targets:[],peers:[]};
  const args=[JSON.stringify(identities),sources.map(s=>s.id)];
  const targets=(await client.query(`SELECT o.* FROM public.orders o WHERE o.execution_id=ANY($2::uuid[]) OR EXISTS(SELECT 1 FROM jsonb_to_recordset($1::jsonb) AS i(owner uuid,player_id bigint,order_id text) WHERE o.user_id=i.owner AND o.player_id=i.player_id AND lower(o.order_id)=i.order_id) ORDER BY o.id${lock?" FOR UPDATE NOWAIT":""}`,args)).rows;
  const peers=(await client.query(`SELECT e.* FROM public.pm_gtc_executions e WHERE EXISTS(SELECT 1 FROM jsonb_to_recordset($1::jsonb) AS i(owner uuid,player_id bigint,order_id text) WHERE e.owner=i.owner AND e.record->'plan'->>'playerId'=i.player_id::text AND lower(e.record->'plan'->>'orderHash')=i.order_id) ORDER BY e.id`,[args[0]])).rows;
  return {targets,peers};
}
export async function planBatch(client,owner,ids) {
  if (!uuid.test(owner) || !Array.isArray(ids) || !ids.length || ids.length>MAX_BATCH || ids.some(id=>!uuid.test(id)) || new Set(ids).size!==ids.length) fail("EXPLICIT_BOUNDED_IDENTITIES_REQUIRED");
  return transaction(client,true,async(client)=>{
    const target=await readTarget(client);await validateSchema(client);
    const sources=(await client.query("SELECT * FROM public.pm_gtc_executions WHERE owner=$1 AND id=ANY($2::uuid[]) ORDER BY id",[owner,ids])).rows;
    const profile=(await client.query("SELECT id FROM public.profiles WHERE id=$1",[owner])).rows;
    const {targets,peers}=await cohort(client,sources),operations=[],conflicts=[],skipped=[];
    for (const id of [...ids].sort()) {
      const source=sources.find(s=>s.id===id);
      if (!source) {conflicts.push({executionId:id,reason:"SOURCE_NOT_OWNED_OR_MISSING"});continue;}
      if (profile.length!==1) {conflicts.push({executionId:id,reason:"OWNER_PROFILE_MISSING"});continue;}
      try {const op=operation(source,targets,peers);if(op.skip)skipped.push({executionId:id,reason:op.skip});else operations.push(op);}
      catch(error){conflicts.push({executionId:id,reason:error.code??"MALFORMED_SOURCE"});}
    }
    return seal({version:1,kind:"batch-plan",target,schemaDigest,owner,ids:[...ids].sort(),operations,conflicts,skipped});
  });
}
async function lockSources(client,operations,target) {
  if (!operations.length || operations.length>MAX_BATCH || new Set(operations.map(o=>o.executionId)).size!==operations.length) fail("INVALID_BATCH_SIZE");
  if (digest(await readTarget(client))!==digest(target)) fail("TARGET_DATABASE_CHANGED");
  await validateSchema(client);const sources=[];
  for (const op of [...operations].sort((a,b)=>a.executionId.localeCompare(b.executionId))) {
    if (!uuid.test(op.executionId) || !uuid.test(op.identity?.owner)) fail("INVALID_BATCH_IDENTITY");
    if ((await client.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired",[op.executionId])).rows[0]?.acquired!==true) fail("EXECUTION_BUSY");
    const s=(await client.query("SELECT * FROM public.pm_gtc_executions WHERE id=$1 AND owner=$2 FOR UPDATE NOWAIT",[op.executionId,op.identity.owner])).rows[0];
    if (!s || digest(s)!==op.sourceHash) fail("SOURCE_CHANGED");
    if ((await client.query("SELECT id FROM public.profiles WHERE id=$1 FOR KEY SHARE NOWAIT",[s.owner])).rows.length!==1) fail("OWNER_PROFILE_MISSING");sources.push(s);
  }
  // 只用于显式小批运维；NOWAIT 不排队，关闭大小写 UNIQUE 无法覆盖的缺行/重复行竞争。
  await client.query("LOCK TABLE public.orders IN SHARE ROW EXCLUSIVE MODE NOWAIT");return sources;
}
export async function applyBatch(client,plan,{attestation,persistPrepared}={}) {
  const body=verifyArtifact(plan,"batch-plan");
  if (body.schemaDigest!==schemaDigest || body.conflicts.length) fail("PLAN_HAS_CONFLICTS_OR_CHANGED_SCHEMA");
  if (!body.operations.length) return {status:"no-op",planDigest:plan.digest};
  return transaction(client,false,async(client)=>{
    requireConsumers(attestation,body.target,"apply");const sources=await lockSources(client,body.operations,body.target),{targets,peers}=await cohort(client,sources,true),changes=[];
    for (const op of body.operations) {
      const source=sources.find(s=>s.id===op.executionId),expected=operation(source,targets,peers);
      if (digest(expected)!==digest(op)) fail("TARGET_OR_PLANNED_PAYLOAD_CHANGED");
      let after;
      if (op.action==="attach") {
        after=(await client.query("UPDATE public.orders SET execution_id=$2,pm_order_mode=$3,pm_order_snapshot=$4 WHERE id=$1 RETURNING *",[op.targetId,op.metadata.execution_id,op.metadata.pm_order_mode,op.metadata.pm_order_snapshot])).rows[0];
        const before=targets.find(t=>t.id===op.targetId);if(digest(withoutMeta(before))!==digest(withoutMeta(after)))fail("ORIGINAL_ORDER_CHANGED");
      } else {
        const r=op.insert;
        after=(await client.query(`INSERT INTO public.orders(user_id,player_id,order_id,link,provider,match,bet,item,create_at,raw,financial_ready,execution_id,pm_order_mode,pm_order_snapshot)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false,$11,'GTC',$12) RETURNING *`,[r.user_id,r.player_id,r.order_id,r.link,r.provider,r.match,r.bet,r.item,r.create_at,r.raw,op.executionId,op.metadata.pm_order_snapshot])).rows[0];
      }
      changes.push({...op,targetId:after.id,afterHash:digest(after)});
    }
    return persist(seal({version:1,kind:"batch-receipt",batchId:randomUUID(),target:body.target,planDigest:plan.digest,schemaDigest,operations:changes}),persistPrepared);
  });
}
export async function rollbackBatch(client,receipt,{attestation,persistPrepared}={}) {
  const body=verifyArtifact(receipt,"batch-receipt");
  if (body.schemaDigest!==schemaDigest) fail("SCHEMA_SOURCE_CHANGED");
  return transaction(client,false,async(client)=>{
    requireConsumers(attestation,body.target,"rollback");const sources=await lockSources(client,body.operations,body.target),{targets,peers}=await cohort(client,sources,true);
    for (const op of [...body.operations].sort((a,b)=>BigInt(a.targetId)===BigInt(b.targetId)?0:BigInt(a.targetId)>BigInt(b.targetId)?-1:1)) {
      const current=targets.find(t=>t.id===op.targetId);
      if (!current || digest(current)!==op.afterHash) fail("TARGET_CHANGED_OR_FINANCIAL_PROMOTION");
      if (targets.filter(t=>t.user_id===op.identity.owner && String(t.player_id)===String(op.identity.playerId) && t.order_id.toLowerCase()===op.identity.orderId.toLowerCase()).length!==1) fail("AMBIGUOUS_ORIGINAL_CASE");
      if (peers.filter(s=>s.owner===op.identity.owner && String(s.record?.plan?.playerId)===String(op.identity.playerId) && s.record?.plan?.orderHash?.toLowerCase()===op.identity.orderId.toLowerCase()).length!==1) fail("MULTIPLE_EXECUTIONS_FOR_ORIGINAL");
      if (op.action==="insert-pending") {
        if (current.financial_ready!==false) fail("FINANCIAL_PROMOTION");
        await client.query("DELETE FROM public.orders WHERE id=$1 AND NOT financial_ready",[op.targetId]);
      } else if (op.action==="attach") {
        if (!op.beforeMeta || ![null,"GTC"].includes(op.beforeMeta.pm_order_mode) || (op.beforeMeta.execution_id && op.beforeMeta.execution_id!==op.executionId)
          || op.beforeMeta.pm_order_snapshot && !knownProjection(op.beforeMeta.pm_order_snapshot,op.executionId)) fail("INVALID_ROLLBACK_METADATA");
        const restored=(await client.query("UPDATE public.orders SET execution_id=$2,pm_order_mode=$3,pm_order_snapshot=$4 WHERE id=$1 RETURNING *",[op.targetId,op.beforeMeta.execution_id,op.beforeMeta.pm_order_mode,op.beforeMeta.pm_order_snapshot])).rows[0];
        if (digest(restored)!==op.targetHash) fail("ROLLBACK_TARGET_NOT_RESTORED");
      } else fail("INVALID_ROLLBACK_ACTION");
    }
    return persist(seal({version:1,kind:"rollback-receipt",batchId:randomUUID(),target:body.target,rolledBackReceipt:receipt.digest,operations:body.operations}),persistPrepared);
  });
}
export async function reconcileReceipt(client,receipt) {
  if (!["batch-receipt","schema-receipt","rollback-receipt"].includes(receipt?.kind)) fail("INVALID_RECEIPT_KIND");
  const body=verifyArtifact(receipt,receipt.kind);
  return transaction(client,true,async(client)=>{
    if (digest(await readTarget(client))!==digest(body.target)) fail("TARGET_DATABASE_CHANGED");
    if (receipt.kind==="schema-receipt") {const h=digest(await catalog(client));return {status:h===body.afterHash?"committed":h===body.beforeHash?"rolled-back":"changed",receiptDigest:receipt.digest};}
    await validateSchema(client);const states=[];
    for (const op of body.operations) {
      const current=(await client.query("SELECT * FROM public.orders WHERE id=$1",[op.targetId])).rows[0];
      const state=current && digest(current)===op.afterHash?"after":op.action==="insert-pending"&&!current || current&&digest(current)===op.targetHash?"before":"changed";
      states.push(receipt.kind==="rollback-receipt" && state!=="changed" ? state==="after"?"before":"after" : state);
    }
    return {status:states.every(s=>s==="after")?"committed":states.every(s=>s==="before")?"rolled-back":"changed",states,receiptDigest:receipt.digest};
  });
}
