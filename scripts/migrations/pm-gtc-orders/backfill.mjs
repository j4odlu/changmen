// [changmen 扩展] 默认离线；唯一数据库执行入口只允许有标记的独立本机测试库。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsonHash, planGtcOrdersMerge } from './plan.mjs';
import { backfillPendingControl } from './backfill-pending.mjs';
import { EXECUTION_TOKEN, isolatedConnection, verifyIsolatedDatabase } from './integration/guard.mjs';

export async function runBackfill(args) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('用法: node scripts/migrations/pm-gtc-orders/backfill.mjs --input snapshot.json --output new-result.json [--execute-isolated]\n默认离线预检；执行只允许专用本机测试库，无生产 apply 入口。\n');
    return 0;
  }
  const options = {}; let execute = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--execute-isolated' && !execute) { execute = true; continue; }
    if (!['--input', '--output'].includes(arg) || options[arg] || !args[index + 1] || args[index + 1].startsWith('--'))
      throw new Error('INVALID_ARGUMENTS');
    options[arg] = args[++index];
  }
  if (!options['--input'] || !options['--output']) throw new Error('INPUT_AND_OUTPUT_REQUIRED');
  const input = path.resolve(options['--input']); const output = path.resolve(options['--output']);
  if (input === output || fs.existsSync(output) || fs.existsSync(output + '.journal.jsonl')) throw new Error('OUTPUT_EXISTS_OR_OVERLAPS');
  const snapshot = JSON.parse(fs.readFileSync(input, 'utf8'));
  const plan = planGtcOrdersMerge(snapshot);
  const operations = plan.operations.filter(operation => operation.action === 'insert-pending');
  const report = { capturedAt: new Date().toISOString(), mode: execute ? 'isolated-backfill' : 'offline-plan',
    databaseConnected: false, productionDatabaseConnected: false, productionApplySupported: false,
    snapshotHash: jsonHash(snapshot), sourceCount: plan.sourceCount, counts: plan.counts,
    preflightPassed: plan.preflightPassed, conflicts: plan.conflicts,
    scope: operations.map(({ executionId, sourceHash }) => ({ executionId, sourceHash })),
    receipts: [], completed: false, committedToGit: false, deployed: false };
  // Reject remote/ordinary databases before importing pg or creating execution evidence.
  const connection = execute ? isolatedConnection(process.env.PM_GTC_TEST_DATABASE_URL, EXECUTION_TOKEN) : null;
  const fd = fs.openSync(output, 'wx'); let pool; let journal; let exitCode = plan.preflightPassed ? 0 : 2;
  const record = event => { fs.writeSync(journal, JSON.stringify({ capturedAt: new Date().toISOString(), ...event }) + '\n'); fs.fsyncSync(journal); };
  try {
    if (execute && plan.preflightPassed) {
      const { Pool } = await import('pg');
      pool = new Pool(connection);
      report.databaseIdentity = await verifyIsolatedDatabase(pool);
      report.databaseConnected = true;
      journal = fs.openSync(output + '.journal.jsonl', 'wx');
      record({ event: 'start', snapshotHash: report.snapshotHash, scope: report.scope });
      for (const operation of operations) {
        record({ event: 'attempt', executionId: operation.executionId, sourceHash: operation.sourceHash });
        const client = await pool.connect();
        try {
          const receipt = await backfillPendingControl(client, operation, { consumersCompatible: true });
          report.receipts.push(receipt);
          record({ event: 'committed', ...receipt });
        } catch (error) {
          report.failedExecutionId = operation.executionId;
          throw error;
        } finally { client.release(); }
      }
      report.completed = report.receipts.length === operations.length;
      record({ event: 'complete', completed: report.completed });
    }
  } catch (error) {
    const code = /^[A-Z0-9_]+$/.test(String(error.code ?? error.message)) ? String(error.code ?? error.message) : 'EXECUTION_FAILED';
    report.failureCode = code; exitCode = 1;
    if (journal != null) record({ event: 'stopped', executionId: report.failedExecutionId ?? null, code });
  } finally {
    await pool?.end();
    if (journal != null) fs.closeSync(journal);
    fs.writeSync(fd, JSON.stringify(report, null, 2) + '\n'); fs.fsyncSync(fd); fs.closeSync(fd);
  }
  process.stdout.write(JSON.stringify({ mode: report.mode, preflightPassed: report.preflightPassed,
    plannedMissing: operations.length, completed: report.completed, receipts: report.receipts.length,
    failureCode: report.failureCode ?? null, productionDatabaseConnected: false }) + '\n');
  return exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await runBackfill(process.argv.slice(2)); }
  catch { process.stderr.write('缺订单回填入口拒绝执行；检查参数、完整快照、输出路径及专用本机测试库配置。\n'); process.exitCode = 1; }
}
