// [changmen 扩展] Install only DB/shared/storage and prove maintenance without any backend tree.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { withTemporaryPostgres } from "./temporary-postgres.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url)), exec = promisify(execFile), checks = [];
const npm = [process.env.CHANGMEN_TEST_NPM_CLI, process.env.npm_execpath,
  path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")].find(file => file && fs.existsSync(file));
if (!npm) throw Error("Set CHANGMEN_TEST_NPM_CLI to an npm CLI JavaScript entry (offline cache required)");
const out = process.env.CHANGMEN_TEST_EVIDENCE_DIR;
await withTemporaryPostgres(async ({ temporary }) => {
  const root = path.join(temporary, "standalone"), workspaces = ["server/db", "server/storage", "packages/shared"];
  fs.mkdirSync(root);
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: repo, encoding: "utf8", maxBuffer: 20 * 1024 * 1024, windowsHide: true }).split("\0").filter(Boolean);
  for (const file of files) {
    if (!workspaces.some(prefix => file.startsWith(`${prefix}/`)) || /(?:^|\/)\.env(?:\.|$)|(?:^|\/)\.npmrc$|\.(?:pem|key|pfx|p12)$/.test(file)) continue;
    if (!fs.existsSync(path.join(repo, file)) || !fs.statSync(path.join(repo, file)).isFile()) continue;
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.copyFileSync(path.join(repo, file), path.join(root, file));
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"));
  pkg.workspaces = workspaces;
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(pkg, null, 2));
  fs.copyFileSync(path.join(repo, "package-lock.json"), path.join(root, "package-lock.json"));
  const args = [npm, "ci", "--offline", "--ignore-scripts", "--omit=dev", "--workspaces", "--include-workspace-root=false", "--no-audit", "--no-fund"];
  const installed = await exec(process.execPath, args, { cwd: root, timeout: 180000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, "standalone-install.log"), installed.stdout + installed.stderr); }
  assert(fs.readFileSync(path.join(root, "package-lock.json")).equals(fs.readFileSync(path.join(repo, "package-lock.json"))));
  assert.deepEqual(fs.readdirSync(path.join(root, "node_modules/@changmen")).sort(), ["db", "shared", "storage"]);
  const noBackend = () => assert(!fs.existsSync(path.join(root, "server/backend")), "Standalone maintenance must never require/create a backend directory");
  noBackend(); checks.push("clean offline production install has only DB/shared/storage, unchanged lock and no backend directory");
  const env = { ...process.env, NODE_PATH: "", NODE_OPTIONS: "", CHANGMEN_STORAGE_DIR: path.join(root, "local-storage"), ESPORT_DATA_DIR: path.join(root, "local-storage/esport") };
  const command = async (name, args = []) => {
    try { return await exec(process.execPath, [path.join(root, `server/db/maintenance/${name}.mjs`), ...args],
      { cwd: temporary, env, timeout: 30000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }); }
    finally { noBackend(); }
  };
  const evaluate = code => exec(process.execPath, ["--input-type=module", "--eval", code], { cwd: root, env, timeout: 30000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  const { default: pg } = await import("../../server/db/pg.js"), client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const ledger = async () => (await client.query("SELECT name,checksum,applied_at FROM changmen_schema_migrations ORDER BY name")).rows;
  try {
    const read = await evaluate(`import assert from 'node:assert/strict';import{createRequire}from'node:module';
      const assets=await import(${JSON.stringify(pathToFileURL(path.join(root, "server/db/maintenance/assets.mjs")).href)});
      assert.equal(assets.listRdsMigrationNames().length,43);assert(assets.readRdsMigrationSql('001_baseline.sql').includes('CREATE'));
      const req=createRequire(import.meta.url);for(const spec of ['vue','pinia','@changmen/venue-adapter','@changmen/client-core','@changmen/pm-market-data-browser'])assert.throws(()=>req.resolve(spec));console.log('local-assets-only');`);
    assert.match(read.stdout, /local-assets-only/); noBackend(); checks.push("reads canonical assets with no backend tree and no browser dependencies");
    for (const name of ["check-rds-schema", "apply-rds-schema"])
      await assert.rejects(command(name), error => error.code === 1 && /数据库结构核验失败/.test(error.stderr));
    assert.equal((await client.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0);
    checks.push("default commands reject an empty database without creating any table");
    assert.match((await command("apply-rds-schema", ["--initialize"])).stdout, /空库初始化完成/);
    const before = await ledger(); assert.equal(before.length, 43);
    checks.push("explicit initialization reads all 43 unchanged migrations from the data package");
    for (const name of ["check-rds-schema", "apply-rds-schema"]) await command(name);
    assert.deepEqual(await ledger(), before); checks.push("successful default commands remain read-only and preserve ledger timestamps");
    await assert.rejects(command("apply-rds-schema", ["--initialize"]), error => error.code === 1 && /数据库已有业务表/.test(error.stderr));
    assert.deepEqual(await ledger(), before); checks.push("explicit initialization refuses existing business tables without replay");
    await evaluate(`import pg from '@changmen/db/pg.js';import{applyOrderObservationSchema}from'@changmen/db/maintenance/apply-order-observation-schema.mjs';const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();try{await applyOrderObservationSchema(c);}finally{await c.end();}`);
    noBackend(); assert.deepEqual(await ledger(), before); checks.push("observation maintenance uses local SQL assets and preserves migration history");
    await evaluate(`import assert from 'node:assert/strict';import pg from '@changmen/db/pg.js';import{reconcileRdsSchema}from'@changmen/db/maintenance/reconcile-rds-schema.mjs';const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();try{const result=await reconcileRdsSchema(c);assert.equal(result.applied,false);}finally{await c.end();}`);
    noBackend(); assert.deepEqual(await ledger(), before); checks.push("reconciliation default SQL loads locally and inspection does not alter the ledger");
  } finally { await client.end(); }
});
const result = { passed: true, localOnly: true, backendDirectoryAbsent: true, credentialsCopied: false, lifecycleScriptsEnabled: false, checks };
if (out) fs.writeFileSync(path.join(out, "standalone-result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
