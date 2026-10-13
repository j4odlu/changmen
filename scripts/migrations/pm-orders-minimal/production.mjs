// [changmen 扩展] 默认只显示计划；生产地址只能显式提供，不读取应用数据库配置。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { applyBatch,digest,installSchema,planBatch,planSchema,readTarget,reconcileReceipt,rollbackBatch,schemaDigest,verifyArtifact } from "./production-tools.mjs";

export function connectionOptions(config,env=process.env) {
  if (!config || config.version!==1 || !/^[A-Z][A-Z0-9_]+$/.test(config.urlEnv??"") || !config.expectedTarget || !config.tlsCaFile) throw Error("EXPLICIT_CONNECTION_IDENTITY_AND_TLS_REQUIRED");
  const raw=env[config.urlEnv];if(!raw)throw Error("MIGRATION_URL_NOT_SET");
  let url;try{url=new URL(raw);}catch{throw Error("INVALID_MIGRATION_URL");}
  if (!["postgres:","postgresql:"].includes(url.protocol) || url.search || url.hash || !url.hostname || !url.username || !url.pathname.slice(1)) throw Error("PLAIN_EXPLICIT_POSTGRES_URL_REQUIRED");
  const target=config.expectedTarget;
  if (!target.database || !target.role || !target.address || !Number.isInteger(target.port) || target.port<=0 || target.port>65535) throw Error("EXPECTED_TARGET_REQUIRED");
  const decode=value=>decodeURIComponent(value);
  if (decode(url.pathname.slice(1))!==target.database || decode(url.username)!==target.role || Number(url.port||5432)!==target.port) throw Error("URL_TARGET_MISMATCH");
  return {host:url.hostname,port:Number(url.port||5432),database:target.database,user:target.role,password:decode(url.password),ssl:{ca:fs.readFileSync(config.tlsCaFile,"utf8"),rejectUnauthorized:true},application_name:"changmen-pm-orders-explicit-migration",connectionTimeoutMillis:5000};
}
export function parseArgs(args) {
  const allowed=new Set(["command","config","owner","ids","input","out","consumers","confirm","execute"]),result={};
  for(let i=0;i<args.length;i++) {
    const key=args[i].slice(2);
    if(!args[i].startsWith("--")||!allowed.has(key)||Object.hasOwn(result,key))throw Error("INVALID_OR_DUPLICATE_ARGUMENT");
    if(key==="execute")result.execute=true;
    else {const value=args[++i];if(!value||value.startsWith("--"))throw Error("ARGUMENT_VALUE_REQUIRED");result[key]=value;}
  }
  if(result.command && !["schema-plan","schema-install","batch-plan","batch-apply","batch-rollback","reconcile"].includes(result.command))throw Error("UNKNOWN_COMMAND");
  if(result.execute && (!result.command||!result.config||!result.out))throw Error("EXPLICIT_COMMAND_CONFIG_OUTPUT_REQUIRED");
  if(result.execute && ["schema-install","batch-apply","batch-rollback"].includes(result.command) && (!result.input||!result.consumers||!result.confirm))throw Error("PLAN_RECEIPT_CONSUMERS_AND_DIGEST_REQUIRED");
  if(result.execute && result.command==="batch-plan" && (!result.owner||!result.ids))throw Error("EXPLICIT_OWNER_AND_IDS_REQUIRED");
  if(result.execute && result.command==="reconcile" && !result.input)throw Error("RECEIPT_REQUIRED");
  return result;
}
export function writeImmutable(file,value) {
  fs.writeFileSync(file,JSON.stringify(value,null,2)+"\n",{flag:"wx",mode:0o600,flush:true});
}
export async function main(args) {
  const opts=parseArgs(args);
  if(!opts.execute) {console.log(JSON.stringify({mode:"plan-only",databaseConnected:false,sqlExecuted:false,schemaDigest,commands:["schema-plan","schema-install","batch-plan","batch-apply","batch-rollback","reconcile"],required:"显式 --execute --config --out；写操作还需已复核 input、consumers 和 confirm digest",batchLimit:25,oldExecutionSource:"pm_gtc_executions",noApplicationCredentials:true},null,2));return;}
  const read=file=>JSON.parse(fs.readFileSync(file,"utf8"));
  const config=read(opts.config),input=opts.input?read(opts.input):null;
  if(input && ["schema-install","batch-apply","batch-rollback"].includes(opts.command) && opts.confirm!==input.digest)throw Error("CONFIRM_DIGEST_MISMATCH");
  const attestation=opts.consumers?read(opts.consumers):null;
  const out=path.resolve(opts.out);if(fs.existsSync(out))throw Error("NEW_OUTPUT_DIRECTORY_REQUIRED");fs.mkdirSync(out,{recursive:true,mode:0o700});
  const {Client}=await import("pg"),client=new Client(connectionOptions(config));
  let receiptFile,receipt;
  const persistPrepared=async value=>{receipt=value;receiptFile=path.join(out,`${value.batchId}.prepared.json`);writeImmutable(receiptFile,value);};
  try {
    await client.connect();
    if(digest(await readTarget(client))!==digest(config.expectedTarget))throw Error("CONNECTED_TARGET_MISMATCH");
    let result;
    switch(opts.command) {
      case "schema-plan":result=await planSchema(client);break;
      case "schema-install":verifyArtifact(input,"schema-plan");result=await installSchema(client,input,{attestation,persistPrepared});break;
      case "batch-plan":result=await planBatch(client,opts.owner,read(opts.ids));break;
      case "batch-apply":verifyArtifact(input,"batch-plan");result=await applyBatch(client,input,{attestation,persistPrepared});break;
      case "batch-rollback":verifyArtifact(input,"batch-receipt");result=await rollbackBatch(client,input,{attestation,persistPrepared});break;
      case "reconcile":result=await reconcileReceipt(client,input);break;
    }
    writeImmutable(path.join(out,"result.json"),result);
    if(receiptFile)writeImmutable(path.join(out,"outcome.json"),{status:"committed",receiptFile:path.basename(receiptFile),receiptDigest:receipt.digest});
    console.log(JSON.stringify({command:opts.command,output:out,status:result.status??(result.kind?.endsWith("plan")?"review-required":"committed"),receipt:receiptFile?path.basename(receiptFile):null}));
  } catch(error) {
    // 文件写入失败或 COMMIT 的网络结果不确定时，不声称已回滚，不自动重试写入。
    const code=/^[A-Z][A-Z0-9_]+$/.test(error.code??"")?error.code:/^[A-Z][A-Z0-9_]+$/.test(error.message??"")?error.message:"OPERATION_FAILED_RECONCILE_BEFORE_RETRY";
    try{writeImmutable(path.join(out,`failure-${randomUUID()}.json`),{code,preparedReceipt:receiptFile?path.basename(receiptFile):null,commitAcknowledgementUncertain:Boolean(receiptFile)});}catch{}
    throw Error(code);
  } finally {await client.end().catch(()=>{});}
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
