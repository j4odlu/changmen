import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { withTemporaryPostgres } from './temporary-postgres.mjs';
import { initializeEmptyRdsSchema } from '@changmen/db/maintenance/apply-rds-schema.mjs';
import { readRdsSchema, readSchemaBaseline, schemaDifferences, verifyRdsSchema } from '@changmen/db/maintenance/rds-schema-check.mjs';
import { RECONCILE_MIGRATION, RECONCILE_TABLES, reconcileRdsSchema, reconciliationSnapshot } from '@changmen/db/maintenance/reconcile-rds-schema.mjs';
import { createReconciliationBackup } from '@changmen/db/maintenance/rds-reconciliation-backup.mjs';
const exec = promisify(execFile), root = fileURLToPath(new URL('../../', import.meta.url));
const cases=[]; const check=async(name,run)=>{await run();cases.push(name);console.log('PASS '+name);};
await withTemporaryPostgres(async({temporary})=>{
  const {getPgPool}=await import('../../rds/pg_pool.js'); const pool=getPgPool();
  const connection=async run=>{const c=await pool.connect();try{return await run(c);}finally{c.release();}};
  const schema=()=>connection(async c=>{await c.query("BEGIN READ ONLY");try{await c.query("SET LOCAL search_path=public,pg_catalog");return await readRdsSchema(c);}finally{await c.query("ROLLBACK");}});
  const verify=()=>connection(c=>verifyRdsSchema(c,{log:()=>{}}));
  const snapshot=()=>connection(async c=>reconciliationSnapshot(c,await readRdsSchema(c)));
  const ledger=async()=>(await pool.query('SELECT * FROM changmen_schema_migrations ORDER BY name')).rows;
  const fixture=readFileSync(new URL('./schema-compatibility/history-layout.sql',import.meta.url),'utf8');
  const backupDirectory=path.join(temporary,'reconciliation-backup');
  try {
    await connection(c=>initializeEmptyRdsSchema(c));
    await check('fresh initialization already matches the single standard',verify);
    await pool.query(fixture); await pool.query('DELETE FROM changmen_schema_migrations WHERE name=$1',[RECONCILE_MIGRATION]);
    await check('the checker rejects the reviewed 17 differences without exceptions',async()=>{
      const differences=schemaDifferences(await schema(),readSchemaBaseline().schema); assert.equal(differences.length,17,differences.join("\n"));
      await assert.rejects(verify(),/数据库结构核验失败/);
    });
    await pool.query("INSERT INTO client_matches_history(id,title,built_at,reverse,archived_at) VALUES(51,'Synthetic archive',1,'[]',1782161950731),(52,'Pre-epoch',1,'[]',-1001)");
    await pool.query("INSERT INTO platform_matches_history(platform,source_match_id,home,away,synced_at,teams,match_id,archived_at) VALUES('OB','history-51','Earlier','B',1,'[]',51,1782161950731),('OB','history-51','Latest','B',1,'[]',51,1782161950732)");
    // Production-sized fixture; no production records or credentials are copied.
    await pool.query("INSERT INTO platform_matches_history(platform,source_match_id,home,away,synced_at,teams,archived_at) SELECT 'PB','scale-'||i,'A','B',1,'[]',1782161950731+i FROM generate_series(1,83000) i");
    await pool.query("INSERT INTO canonical_teams(gb_team_id,game,name) VALUES(501,'lol','Synthetic canonical')");
    await pool.query("INSERT INTO team_venue_maps(gb_team_id,venue,venue_team_id,venue_name) VALUES(501,'OB','501','Synthetic venue')");
    const original=await snapshot(), originalSchema=await schema(), originalLedger=await ledger();
    await check('unknown source differences block maintenance without repair',async()=>{
      await pool.query('ALTER TABLE platform_matches_history ALTER COLUMN match_id TYPE text');
      try { await assert.rejects(connection(c=>reconcileRdsSchema(c)),/Unreviewed migration source/); }
      finally { await pool.query('ALTER TABLE platform_matches_history ALTER COLUMN match_id TYPE integer USING match_id::integer'); }
      assert.deepEqual(await snapshot(),original);
    });
    await check('NULL constraint failure rolls back time conversion, schema and ledger',async()=>{
      await pool.query("UPDATE client_matches_history SET title=NULL WHERE id=51");
      const before=await snapshot();
      await assert.rejects(connection(c=>reconcileRdsSchema(c)),e=>e.code==='23502');
      assert.deepEqual(await schema(),originalSchema);assert.deepEqual(await snapshot(),before);assert.deepEqual(await ledger(),originalLedger);
      await pool.query("UPDATE client_matches_history SET title='Synthetic archive' WHERE id=51");
    });
    await check('lock timeout releases the migration lock and leaves all data unchanged',async()=>{
      const blocker=await pool.connect();
      try {await blocker.query('BEGIN');await blocker.query('SELECT 1 FROM client_matches_history LIMIT 1');
        await assert.rejects(connection(c=>reconcileRdsSchema(c)),e=>e.code==='55P03');
        assert.equal((await blocker.query("SELECT pg_try_advisory_xact_lock(hashtextextended('changmen:rds-schema',0)) AS ok")).rows[0].ok,true);
      }finally{await blocker.query('ROLLBACK');blocker.release();}
      assert.deepEqual(await snapshot(),original);
    });
    await check('production-sized rehearsal verifies then rolls back every change',async()=>{
      const result=await connection(c=>reconcileRdsSchema(c));assert.equal(result.dataUnchanged,true);assert.equal(result.dryRun,true);
      assert.deepEqual(await snapshot(),original);assert.deepEqual(await schema(),originalSchema);assert.deepEqual(await ledger(),originalLedger);
    });
    await check('missing or failed backup cannot apply a migration',async()=>{
      await assert.rejects(connection(c=>reconcileRdsSchema(c,{apply:true})),/durable backup/);
      await assert.rejects(connection(c=>reconcileRdsSchema(c,{apply:true,backup:async()=>{throw Error('backup failure');}})),/backup failure/);
      assert.deepEqual(await schema(),originalSchema);assert.deepEqual(await snapshot(),original);
    });
    const {fetchPlatformMatchesForHiddenClientMatches}=await import('../../rds/rds/matcher_store.js');
    const hidden=async()=> (await fetchPlatformMatchesForHiddenClientMatches([{id:51,matchs:{OB:'history-51'}}])).map(r=>({...r,match_id:r.match_id==null?null:Number(r.match_id)}));
    // matcher_data.js normalizes match_id to Number before producing UI output.
    assert.match(readFileSync(path.join(root,'server/match/matcher/ui/matcher_data.js'),'utf8'),/match_id: raw.match_id != null \? Number\(raw.match_id\) : null/);
    const beforeHidden=await hidden();assert.equal(beforeHidden[0].home,'Latest');
    await pool.query("INSERT INTO client_matches(id,title,built_at,ended_at,matchs) VALUES(51,'UI hidden',9999999999999,1,'{\"OB\":\"history-51\"}')");
    const {fetchMatcherHiddenClientMatches}=await import('../../server/match/matcher/ui/matcher_data.js');
    const hiddenApi=async()=>{const {updatedAt,...wire}=await fetchMatcherHiddenClientMatches();return wire;};
    const beforeApi=await hiddenApi();
    await check('explicit migration preserves every row, duplicate, timestamp and identity value',async()=>{
      const result=await connection(c=>reconcileRdsSchema(c,{apply:true,backup:createReconciliationBackup(backupDirectory)}));
      assert.equal(result.applied,true);assert.deepEqual(result.before,result.after);await verify();
      assert.deepEqual(await snapshot(),original);assert.deepEqual(await hidden(),beforeHidden);assert.deepEqual(await hiddenApi(),beforeApi);
      assert.deepEqual((await ledger()).filter(r=>r.name!==RECONCILE_MIGRATION),originalLedger);
      assert.equal((await ledger()).length,originalLedger.length+1);
    });
    await check('backup round-trip restores the original source data and sequence',async()=>{
      const c=await pool.connect();try{await c.query('BEGIN');await c.query(fixture);
        for(const table of RECONCILE_TABLES){await c.query('TRUNCATE '+table);
          const lines=readFileSync(path.join(backupDirectory,table+'.jsonl'),'utf8').trim().split('\n').filter(Boolean);
          // Bulk JSON parsed by PostgreSQL, never rounded through JavaScript.
          for(let i=0;i<lines.length;i+=500) await c.query('INSERT INTO '+table+' OVERRIDING SYSTEM VALUE SELECT * FROM json_populate_recordset(NULL::'+table+',$1::json)',['['+lines.slice(i,i+500).join(',')+']']);
        }
        assert.deepEqual(await reconciliationSnapshot(c,await readRdsSchema(c)),original);
      }finally{await c.query('ROLLBACK');c.release();}await verify();
    });
    await check('data fingerprints detect microsecond changes for positive and negative epochs',async()=>{
      const c=await pool.connect();
      try {
        await c.query('BEGIN');
        const before=await reconciliationSnapshot(c,await readRdsSchema(c));
        await c.query("UPDATE client_matches_history SET archived_at=archived_at+INTERVAL '1 microsecond' WHERE id IN (51,52)");
        const after=await reconciliationSnapshot(c,await readRdsSchema(c));
        assert.notEqual(after.tables.client_matches_history.digest,before.tables.client_matches_history.digest);
      }finally{await c.query('ROLLBACK');c.release();}
    });
    await check('canonical rerun does not alter rows, sequence or ledger timestamps',async()=>{
      const records=await ledger();const result=await connection(c=>reconcileRdsSchema(c,{apply:true,backup:createReconciliationBackup(path.join(temporary,'second-backup'))}));
      assert.equal(result.alreadyCanonical,true);assert.equal(result.applied,false);
      assert.deepEqual(await snapshot(),original);assert.deepEqual(await ledger(),records);
    });
    await check('unchanged archive writer handles bigint IDs and preserves hidden-match output',async()=>{
      const {archiveStaleRows,ARCHIVE_SCOPE_ALL}=await import('../../rds/archive_stale.js');
      await pool.query("INSERT INTO client_matches(id,title,built_at,ended_at,matchs) VALUES(2147483648,'A vs B',1,1,'{\"OB\":\"large-id\"}')");
      await pool.query("INSERT INTO platform_matches(platform,source_match_id,match_id,home,away,synced_at) VALUES('OB','large-id',2147483648,'A','B',1)");
      const from=Date.now(),result=await archiveStaleRows({scope:ARCHIVE_SCOPE_ALL,cutoffMs:10});
      assert.equal(result.rds.client_matches,1);assert.equal(result.rds.platform_matches,1);
      const row=(await pool.query('SELECT * FROM client_matches_history WHERE id=2147483648')).rows[0];
      assert.equal(row.id,'2147483648');assert(row.archived_at instanceof Date);assert(row.archived_at.getTime()>=from&&row.archived_at.getTime()<=Date.now());
      assert.equal((await fetchPlatformMatchesForHiddenClientMatches([{id:2147483648,matchs:{OB:'large-id'}}]))[0].home,'A');
    });
    await check('renamed identity, primary key and foreign key retain enforcement',async()=>{
      const id=(await pool.query("INSERT INTO team_venue_maps(gb_team_id,venue,venue_team_id,venue_name) VALUES(501,'PB','501','Venue B') RETURNING id")).rows[0].id;
      assert.equal(BigInt(id),BigInt(original.sequence.last_value)+1n);
      await assert.rejects(pool.query("INSERT INTO team_venue_maps(id,venue,venue_name) OVERRIDING SYSTEM VALUE VALUES($1,'PB','Duplicate')",[id]),e=>e.code==='23505');
      await assert.rejects(pool.query("INSERT INTO team_venue_maps(gb_team_id,venue,venue_name) VALUES(999999,'PB','Missing')"),e=>e.code==='23503');
    });
    await check('real publication shell and CLI accept canonical schema and block missing columns',async()=>{
      const before=await snapshot(),records=await ledger(),log=path.join(temporary,'gate.log');writeFileSync(log,'');
      const child=exec(process.platform==='win32'?'C:/msys64/usr/bin/bash.exe':'bash',['scripts/deploy/release.test.sh'],{cwd:root,timeout:120000,windowsHide:true,maxBuffer:8*1024*1024,env:{...process.env,...(process.platform==='win32'?{MSYS:'winsymlinks:nativestrict'}:{}),TEST_SCHEMA_RUNNER:path.join(root,'scripts/testing/schema-compatibility/gate-runner.mjs').replaceAll('\\','/'),TEST_REAL_GATE_LOG:log}});
      child.child.stdin.end();const result=await child;assert.match(result.stdout,/PASS release integration/);
      assert.match(readFileSync(log,'utf8'),/canonical-preflight-passed/);assert.match(readFileSync(log,'utf8'),/missing-column-rejected/);
      assert.deepEqual(await snapshot(),before);assert.deepEqual(await ledger(),records);
    });
    await check('preflight lock timeout fails within a bounded time without schema mutation',async()=>{
      const c=await pool.connect();try{await c.query('BEGIN');await c.query('LOCK TABLE changmen_schema_migrations IN ACCESS EXCLUSIVE MODE');
        await assert.rejects(exec(process.execPath,[path.join(root,'rds/maintenance/check-rds-schema.mjs')],{cwd:root,timeout:10000,windowsHide:true}),e=>e.code===1&&/lock timeout/.test(e.stderr));
      }finally{await c.query('ROLLBACK');c.release();}await verify();
    });
    await check('read-only preflight never creates a missing ledger',async()=>{
      await pool.query('DROP TABLE changmen_schema_migrations');await verify();
      assert.equal((await pool.query("SELECT to_regclass('public.changmen_schema_migrations') AS name")).rows[0].name,null);
    });
    console.log(JSON.stringify({passed:true,localOnly:true,checks:cases.length,cases},null,2));
  }finally{await pool.end();}
});
