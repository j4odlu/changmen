import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import {compareAdminMaintenance} from './admin-maintenance-comparison.mjs';
let networkCalls=0;
const blocked=()=>{networkCalls++;throw Error('Network forbidden in report comparison');};
net.connect=blocked;net.createConnection=blocked;net.Socket.prototype.connect=blocked;tls.connect=blocked;
const shared=[
 {key:'OB:1',provider:'OB',venue_member_id:'1',player_id:11,user_name:'甲',user_id:'u1',platform_name:'OB',player_name:'a',venue_account_name:' a ',deleted:false,created_at:'1000',deleted_at:null,order_count:'2'},
 {key:'OB:1',provider:'OB',venue_member_id:'1',player_id:12,user_name:'乙',user_id:'u2',deleted:false,created_at:null,order_count:0},
 {key:'PB:2',provider:'PB',player_id:13,user_name:'甲',user_id:'u1',deleted:true,deleted_at:'2000'},
 {key:'PB:2',provider:'PB',player_id:14,user_name:'乙',user_id:'u2',deleted:true},
 {key:'RAY:3',provider:'RAY',player_id:15,user_name:'乙',user_id:'u2',deleted:true},
 {key:'RAY:3',provider:'RAY',player_id:16,user_name:'甲',user_id:'u1',deleted:false},
];
const same=[{oid:'duplicate',user_id:'u1',user_name:'甲',n:'2',ids:[1,2],player_ids:['11','12'],providers:['OB','OB'],statuses:['Reject','Success'],moneys:['1.25','0'],min_at:1704038400000,max_at:1704124800000}];
const cross=[{oid:'duplicate',n:3,user_n:2,names:['乙','甲'],ids:[1,2,3],user_ids:['u1','u1','u2'],user_names:['甲','甲','乙'],player_ids:['11',null,'12'],providers:['OB',null,'OB'],statuses:['Success',null,'Reject'],moneys:['0.125',null,'10'],min_at:1704038400000}];
const cases=[];
cases.push(await compareAdminMaintenance(async()=>({rows:[]})));
const populated=await compareAdminMaintenance(async sql=>({rows:sql.includes('WITH multi')?shared:sql.includes('o.user_id, pr.user_name')?same:cross}));
assert.equal(populated[0].value.bothActive,1);assert.equal(populated[0].value.total,3);
assert.equal(populated[1].value.sameUserTotal,1);assert.equal(populated[1].value.crossUserTotal,1);cases.push(populated);
cases.push(await compareAdminMaintenance(async()=>({}),{}));
cases.push(await compareAdminMaintenance(async()=>{throw Error('query failed');}));
cases.push(await compareAdminMaintenance(async()=>{throw Error('must not query');},{unavailable:true}));
cases.push(await compareAdminMaintenance(async()=>{throw Error('must not query');},{readyError:true}));
assert.equal(networkCalls,0);
console.log(JSON.stringify({passed:true,scenarios:cases.length,comparisons:cases.length*3,networkCalls}));
