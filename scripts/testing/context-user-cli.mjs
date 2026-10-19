// Native CLI comparison fixture: no real database driver, configuration load or network.
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import crypto from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import {RDS_CONTEXT_RELOCATION as record} from '../verification/rds-context-relocation.mjs';
const [mode,scenario]=process.argv.slice(2);assert(['before','after'].includes(mode));
const cases={
 missingArgs:{args:[]},missingDb:{args:['fixture','synthetic-password']},
 missingJwt:{args:['fixture','synthetic-password'],url:true},
 create:{args:['fixture','synthetic-password'],url:true,jwt:true},
 updateAdmin:{args:['--admin','fixture','synthetic-password'],url:true,jwt:true,existing:true},
 profileFailure:{args:['fixture','synthetic-password'],url:true,jwt:true,profileFailure:true},
 queryFailure:{args:['fixture','synthetic-password'],url:true,jwt:true,queryFailure:true},
};
const config=cases[scenario];assert(config);
const state={events:[],logs:[],errors:[],networkCalls:0};globalThis.__contextUser={state,config};
const blocked=()=>{state.networkCalls++;throw Error('Network forbidden');};net.connect=blocked;net.createConnection=blocked;net.Socket.prototype.connect=blocked;tls.connect=blocked;
console.log=(...args)=>state.logs.push(args);console.error=(...args)=>state.errors.push(args);
crypto.randomUUID=()=> '00000000-0000-0000-0000-000000000101';Date.now=()=>1792440000000;
process.env.DATABASE_URL=config.url?'postgresql://synthetic@127.0.0.1/unopened':'';
process.env.DATABASE_URL_PUBLIC='';process.env.DATABASE_URL_INTERNAL='';process.env.JWT_SECRET=config.jwt?'synthetic-secret-for-comparison-only':'';
const facade=`const {state:s,config:c}=globalThis.__contextUser;
export async function initDatabaseUrl(){s.events.push(['init']);}
export function buildPgClientConfig(url){s.events.push(['config',url]);return {connectionString:url};}
export async function insertProfile(...args){s.events.push(['profile',...args]);return !c.profileFailure;}`;
const driver=`const {state:s,config:c}=globalThis.__contextUser;
export default {Client:class{constructor(options){s.events.push(['client',options]);}async connect(){s.events.push(['connect']);}async end(){s.events.push(['end']);}async query(...args){s.events.push(['query',...args]);if(c.queryFailure)throw Error('synthetic query failure');return {rows:args[0].startsWith('SELECT')&&c.existing?[{id:'00000000-0000-0000-0000-000000000102'}]:[]};}}};`;
const data=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
registerHooks({resolve(spec,context,next){if(spec==='@changmen/db')return{url:data(facade),shortCircuit:true};if(spec==='@changmen/db/pg.js')return{url:data(driver),shortCircuit:true};return next(spec,context);}});
process.on('exit',()=>process.stdout.write(JSON.stringify(state)+'\n'));
const row=record.moves.find(row=>row.context==='data-user-cli');
process.argv=['node',mode==='before'?row.file:row.canonical,...config.args];
await import(mode==='before'?data(row.before):new URL('../../'+row.canonical,import.meta.url));
