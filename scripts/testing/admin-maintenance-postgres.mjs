import assert from 'node:assert/strict';
import pg from '../../rds/pg.js';
import {withTemporaryPostgres} from './temporary-postgres.mjs';
import {compareAdminMaintenance} from './admin-maintenance-comparison.mjs';
await withTemporaryPostgres(async()=>{
 const url=new URL(process.env.DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.username,'changmen_test');
 const client=new pg.Client({connectionString:url.href,ssl:false});await client.connect();
 try{
  await client.query(`CREATE TABLE profiles(id text PRIMARY KEY,user_name text);
   CREATE TABLE players(id integer,venue_account_key text,provider text,venue_member_id text,owner_user_id text,platform_name text,player_name text,account_data jsonb,deleted_at bigint,created_at bigint);
   CREATE TABLE orders(id integer,order_id text,user_id text,player_id integer,provider text,status text,money numeric,create_at bigint);
   INSERT INTO profiles VALUES('u1','甲'),('u2','乙'),('u3','丙');
   INSERT INTO players VALUES
    (1,'OB:shared','OB','shared','u1','OB','first','{"venueAccountName":" first "}',NULL,1704000000000),
    (2,'OB:shared','OB','shared','u2','OB','second','{}',NULL,1704000000001),
    (3,'PB:deleted','PB','deleted','u2','PB','old','{}',1704000000010,1704000000002),
    (4,'PB:deleted','PB','deleted','u3','PB','older','{}',1704000000011,1704000000003);
   INSERT INTO orders VALUES
    (1,'DUP','u1',1,'OB','Success',1.25,1704000000000),
    (2,'dup','u1',1,'OB','Reject',2.5,1704000000001),
    (3,'Dup','u2',2,'OB','Success',5.125,1704000000002),
    (4,'','u3',4,'PB','Success',0,1704000000003),
    (5,NULL,'u3',4,'PB','Success',0,1704000000004);`);
  const before=(await client.query('SELECT row_to_json(o) AS row FROM orders o ORDER BY id')).rows;
  await client.query('SET default_transaction_read_only = on');
  const results=await compareAdminMaintenance((...args)=>client.query(...args));
  assert.equal(results[0].value.total,2);assert.equal(results[0].value.bothActive,1);
  assert.equal(results[1].value.sameUserTotal,1);assert.equal(results[1].value.crossUserTotal,1);
  assert.equal(results[0].value.list.find(group=>group.venueAccountKey==='OB:shared').players.find(player=>player.playerId===1).orderCount,2);
  assert.equal(results[1].value.crossUser[0].rows[2].money,5.125);
  assert.deepEqual((await client.query('SELECT row_to_json(o) AS row FROM orders o ORDER BY id')).rows,before);
  await assert.rejects(client.query('DELETE FROM orders'),error=>error.code==='25006');
  console.log(JSON.stringify({passed:true,localOnly:true,comparisons:3,readOnly:true,orderRowsUnchanged:true}));
 }finally{await client.end();}
});
