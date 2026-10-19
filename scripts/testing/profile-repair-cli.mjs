// [changmen 扩展] Native before/after CLI fixture with database/cache/network boundaries stubbed.
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import {registerHooks} from 'node:module';
import {PROFILE_REPAIR_ISOLATION as record} from '../verification/profile-repair-isolation.mjs';
const [mode,script,scenario]=process.argv.slice(2);
assert(['before','after'].includes(mode));assert(['dedupe','prune','rebuild'].includes(script));
const config={scenario,dryRun:scenario==='dryRun',missingUser:scenario==='missingUser',noChange:scenario==='noChange',noKeep:scenario==='noKeep',empty:scenario==='empty',existing:scenario==='existing',foreign:scenario==='foreign',missingPlayer:scenario==='missingPlayer',failRead:scenario==='readFailure',failWrite:scenario==='writeFailure',failCache:scenario==='cacheFailure',failReady:scenario==='readyFailure',failEnd:scenario==='endFailure'};
const owner='00000000-0000-0000-0000-000000000101';
const accounts=[47,48,46].map(id=>({accountId:id,provider:'fixture',platformName:'fixture-platform',playerName:'fixture-player-'+id,preserved:{credential:'synthetic-only'}}));
const state={events:[],logs:[],warnings:[],networkCalls:0,failure:null};
const blocked=()=>{state.networkCalls++;throw Error('Network forbidden');};
net.connect=blocked;net.createConnection=blocked;net.Socket.prototype.connect=blocked;tls.connect=blocked;globalThis.fetch=blocked;
console.log=(...args)=>state.logs.push(args);console.warn=(...args)=>state.warnings.push(args);Date.now=()=>1792440000000;
const pool={
 async query(sql,params){
  state.events.push(['query',sql,params]);
  if(config.failRead&&sql.startsWith('SELECT'))throw Error('synthetic read failure');
  if(sql.startsWith('UPDATE')){if(config.failWrite)throw Error('synthetic write failure');return{rows:[],rowCount:1};}
  if(sql.startsWith('SELECT p.id, p.accounts'))return{rows:config.missingUser?[]:[{id:owner,accounts:config.empty?null:config.noKeep?[{accountId:45}]:config.noChange?accounts:[...accounts,{AccountId:45}]}]};
  if(sql.startsWith('SELECT p.id FROM profiles'))return{rows:config.missingUser?[]:[{id:owner}]};
  if(sql.startsWith('SELECT id, platform_name'))return{rows:(config.empty?[]:config.noChange?[46,47,48]:[46,47,48,91]).map(id=>({id:String(id),platform_name:'fixture-platform',player_name:'fixture-player-'+id,provider:id===91?null:'fixture'}))};
  if(sql.startsWith('SELECT id FROM users'))return{rows:config.missingUser?[]:[{id:owner}]};
  if(sql.startsWith('SELECT accounts FROM profiles'))return{rows:[{accounts:config.existing?accounts:config.empty?null:[]}]};
  if(sql.startsWith('SELECT id, platform_id'))return{rows:config.missingPlayer?[]:[{id:params[0],platform_id:'7',platform_name:'fixture-platform',player_name:'fixture-player-'+params[0]}]};
  if(sql.startsWith('SELECT owner_user_id'))return{rows:[{owner_user_id:config.foreign?'00000000-0000-0000-0000-000000000102':owner}]};
  throw Error('Unreviewed fixture query');
 },
 async end(){state.events.push(['end']);if(config.failEnd)throw Error('synthetic end failure');},
};
globalThis.__profileRepairFixture={state,config,pool};
const data=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const pg=`const {state:s,config:c,pool}=globalThis.__profileRepairFixture;export async function ensurePgPoolReady(){s.events.push(['ready']);if(c.failReady)throw Error('synthetic ready failure');}export function getPgPool(){s.events.push(['get']);return pool;}`;
const cache=`const {state:s,config:c}=globalThis.__profileRepairFixture;async function record(name,args){s.events.push([name,...args]);if(c.failCache&&name!=='pullProfilesFromDb')throw Error('synthetic cache failure');}export const loadProfileById=(...args)=>record('loadProfileById',args);export const loadAccountsForUser=(...args)=>record('loadAccountsForUser',args);export const pullProfilesFromDb=(...args)=>record('pullProfilesFromDb',args);`;
registerHooks({resolve(spec,context,next){
 if(spec==='@changmen/db'||spec==='../pg_pool.js'&&context.parentURL?.endsWith('/maintenance/profile_repairs.js'))return{url:data(pg),shortCircuit:true};
 if(spec==='@changmen/storage/load_env.js')return{url:data(`export function loadChangmenEnv(){globalThis.__profileRepairFixture.state.events.push(['env']);}`),shortCircuit:true};
 if(spec.endsWith('/core/db/store.js'))return{url:data(cache),shortCircuit:true};
 return next(spec,context);
}});
const index={dedupe:0,prune:1,rebuild:2}[script],row=record.entries[index];
process.argv=['node',row.file,...(config.dryRun?['--dry-run']:[])];
process.on('exit',()=>process.stdout.write(JSON.stringify(state)+'\n'));
try{await import(mode==='before'?data(row.before):new URL('../../'+row.file,import.meta.url));}
catch(error){state.failure=error.message;process.exitCode=1;}
