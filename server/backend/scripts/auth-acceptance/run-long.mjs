import assert from 'node:assert/strict';
import {io} from 'socket.io-client';
import {mkdirSync, writeFileSync} from 'node:fs';
mkdirSync('output', {recursive: true});
const base='http://127.0.0.1:4930', origin='http://127.0.0.1:4931';
const started=Date.now(); const evidence={started:new Date(started).toISOString(),checks:[]};
const response=await fetch(base+'/auth/login',{method:'POST',headers:{origin,'content-type':'application/json','x-changmen-auth':'cookie'},body:JSON.stringify({userName:'acceptance-long',password:'Acceptance-Only-2026!'})});
const result=await response.json();assert.equal(response.status,200,JSON.stringify(result)); assert.equal(result.info.token,undefined);
const cookie=response.headers.get('set-cookie').split(';')[0];
async function session(){const r=await fetch(base+'/auth/session',{headers:{origin,cookie}});assert.equal(r.status,200);return r.json();}
const s=await session(); evidence.checks.push('native login without JWT; session identity');
async function matches(){const r=await fetch(base+'/esport/Client_GetMatchs',{method:'POST',headers:{origin,cookie,'content-type':'application/json','x-csrf-token':s.csrfToken},body:'{}'});const j=await r.json();assert.equal(j.success,1,JSON.stringify(j));assert.equal(j.info.length,1);return j;}
await matches();
const ws=io(base,{path:'/esport/realtime/socket.io',transports:['websocket'],auth:{protocol:'cookie'},extraHeaders:{origin,cookie},reconnection:false});
async function connected(socket){await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('WS timeout')),10000);socket.once('connect',()=>{clearTimeout(t);resolve();});socket.once('connect_error',e=>{clearTimeout(t);reject(e);});});}
await connected(ws);assert.equal((await ws.timeout(5000).emitWithAck('pubsub:subscribe',{channel:`USER:${s.user.id}`})).ok,true);assert.equal((await ws.timeout(5000).emitWithAck('pubsub:subscribe',{channel:'USER:unrelated'})).ok,false);
evidence.checks.push('Cookie WS handshake; own channel allowed; foreign channel denied');
const times=[];await Promise.all(Array.from({length:100},async()=>{const t=Date.now();await matches();times.push(Date.now()-t);}));times.sort((a,b)=>a-b);evidence.load={requests:100,concurrency:100,errors:0,p50:times[49],p95:times[94],max:times[99]};
writeFileSync('output/auth-acceptance-long.json',JSON.stringify(evidence,null,2)); console.log('LONG_RUN_STARTED',JSON.stringify(evidence));
await new Promise(resolve=>setTimeout(resolve,960000));
assert.equal(ws.connected,true);await session();await matches();ws.disconnect();ws.connect();await connected(ws);assert.equal((await ws.timeout(5000).emitWithAck('pubsub:subscribe',{channel:`USER:${s.user.id}`})).ok,true);
evidence.checks.push('real wall-clock 16 min session and WS active; reconnect and resubscribe after JWT TTL');evidence.elapsedMs=Date.now()-started;evidence.passed=true;ws.close();writeFileSync('output/auth-acceptance-long.json',JSON.stringify(evidence,null,2));console.log('LONG_RUN_PASSED',evidence.elapsedMs);
