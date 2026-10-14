// [changmen 扩展] 默认只显示计划；生产地址只能显式提供，不读取应用数据库配置。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
/** [changmen 扩展] 旧存储方案只供历史验收，生产迁移入口已退役。 */
export async function main(args) {
  const opts=parseArgs(args);
  if(opts.execute) throw Error("RETIRED_STORAGE_MODE_USE_TWO_TABLE_GTC");
  console.log(JSON.stringify({mode:"retired",databaseConnected:false,sqlExecuted:false,
    reason:"旧订单存储模式已退役；当前保留 orders 与 pm_gtc_executions 两张表",
    currentTool:"scripts/migrations/river-gtc/result-copies.mjs",noApplicationCredentials:true},null,2));
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
