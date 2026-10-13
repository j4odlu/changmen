// [changmen 扩展] 显式创建并停止自己的临时 PostgreSQL 实例；不复用已有服务/库。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
if (process.argv.length !== 3 || process.argv[2] !== '--execute-local') {
  process.stdout.write('计划：显式 --execute-local 后，在 127.0.0.1:55443 创建全新有标记测试库，执行 87 项集成验收并停止自己的实例。无生产连接；默认不执行。\n');
  if (process.argv.length > 2 && !(process.argv.length === 3 && process.argv[2] === '--plan')) process.exitCode = 1;
} else {
  const binary = process.env.PM_GTC_PG_BIN ?? 'D:/PostgreSQL/18/bin';
  const port = 55443;
  const attempt = path.join(root, 'output/pm-orders-minimal-local', `${Date.now()}-${crypto.randomUUID()}`);
  const data = path.join(attempt, 'cluster');
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/DATABASE|^PG[A-Z_]|^ORDERS_EXECUTION_COMPAT$/.test(key)));
  const adminRole = 'changmen_phase2_admin';
  const adminPassword = crypto.randomBytes(32).toString('hex'); const testPassword = crypto.randomBytes(32).toString('hex');
  let started = false; let testExit = 1;
  fs.mkdirSync(attempt, { recursive: true });
  const passwordFile = path.join(attempt, 'initdb-password.tmp');
  const sources = execFileSync('rg', ['--files', '--hidden', '-g', '!.git', '-g', '!node_modules', '-g', '!output', '-g', '!client/web/dist'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/);
  const hash = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
  const start = { capturedAt: new Date().toISOString(), head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), hashes: Object.fromEntries(sources.map(file => [file, hash(file)])) };
  fs.writeFileSync(path.join(attempt, 'scope-start.json'), JSON.stringify(start, null, 2));
  const run = (name, args, env = cleanEnv) => {
    const log = fs.openSync(path.join(attempt, `${name}-${Date.now()}.log`), 'wx');
    let result;
    try { result = spawnSync(path.join(binary, `${name}${process.platform === 'win32' ? '.exe' : ''}`), args,
      { cwd: root, env, windowsHide: true, stdio: ['ignore', log, log], timeout: 20000 }); }
    finally { fs.closeSync(log); }
    if (result.status !== 0) throw new Error(`${name} failed; inspect retained local logs`);
  };
  try {
    await new Promise((resolve, reject) => {
      const probe = net.createServer(); probe.once('error', () => reject(new Error('Test port busy; existing service will not be touched')));
      probe.listen(port, '127.0.0.1', () => probe.close(resolve));
    });
    fs.writeFileSync(passwordFile, adminPassword, { mode: 0o600 });
    run('initdb', ['-D', data, '-U', adminRole, '--encoding=UTF8', '--locale=C', '--auth=scram-sha-256', `--pwfile=${passwordFile}`]);
    fs.rmSync(passwordFile);
    fs.appendFileSync(path.join(data, 'postgresql.conf'), `\nlisten_addresses='127.0.0.1'\nport=${port}\nshared_buffers='32MB'\nmax_connections=20\n`);
    run('pg_ctl', ['-D', data, '-l', path.join(attempt, 'postgres.log'), '-w', '-t', '10', 'start']);
    started = true;
    const { Client } = await import('pg');
    const admin = new Client({ host: '127.0.0.1', port, user: adminRole, password: adminPassword, database: 'postgres', ssl: false, connectionTimeoutMillis: 3000 });
    try {
      await admin.connect();
      const row = (await admin.query("SELECT current_database() AS database,current_user AS role,host(inet_server_addr()) AS address,current_setting('data_directory') AS directory,current_setting('server_version') AS version")).rows[0];
      if (row.database !== 'postgres' || row.role !== adminRole || row.address !== '127.0.0.1'
        || fs.realpathSync.native(row.directory).toLowerCase() !== fs.realpathSync.native(data).toLowerCase())
        throw new Error('Fresh cluster identity mismatch; provisioning refused');
      fs.writeFileSync(path.join(attempt, 'instance.json'), JSON.stringify({ ...row, port, productionConnection: false }, null, 2));
      run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', String(port), '-U', adminRole, '-d', 'postgres', '-f', path.join(root, 'scripts/migrations/pm-gtc-orders/integration/create-test-db.sql')], { ...cleanEnv, PGPASSWORD: adminPassword, PGSSLMODE: 'disable' });
      // Generated hex only; no credentials written to evidence or printed.
      await admin.query(`ALTER ROLE changmen_orders_phase2_test PASSWORD '${testPassword}'`);
    } finally { await admin.end(); }
    const env = { ...cleanEnv, PM_GTC_TEST_DATABASE_URL: `postgresql://changmen_orders_phase2_test:${testPassword}@127.0.0.1:${port}/changmen_orders_phase2_test_v1` };
    const result = spawnSync(process.execPath, ['scripts/migrations/pm-orders-minimal/run.mjs', '--execute-isolated'],
      { cwd: root, env, windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 180000 });
    fs.writeFileSync(path.join(attempt, 'integration.log'), (result.stdout ?? '') + (result.stderr ?? ''));
    testExit = result.status ?? 1;
    process.stdout.write(`Evidence: ${attempt}\nIntegration exit: ${testExit}\n`);
  } catch (error) { process.stderr.write(error.message + '\n'); }
  finally {
    if (fs.existsSync(passwordFile)) fs.rmSync(passwordFile);
    if (started) {
      try { run('pg_ctl', ['-D', data, '-m', 'fast', '-w', '-t', '10', 'stop']); }
      catch (error) { testExit = 1; process.stderr.write(error.message + '\n'); }
    }
    const changed = sources.filter(file => !fs.existsSync(path.join(root, file)) || hash(file) !== start.hashes[file]);
    const endHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    fs.writeFileSync(path.join(attempt, 'scope-end.json'), JSON.stringify({ capturedAt: new Date().toISOString(), changed,
      headUnchanged: start.head === endHead, sourceFilesUnchanged: changed.length === 0,
      testExit, instanceStopped: started && !fs.existsSync(path.join(data, 'postmaster.pid')),
      productionConnection: false, productionWrites: false, committed: false, deployed: false }, null, 2));
    process.exitCode = testExit;
  }
}
