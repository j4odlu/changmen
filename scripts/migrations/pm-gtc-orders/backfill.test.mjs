import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { accepted, OWNER } from './integration/fixtures.mjs';

const cli = 'scripts/migrations/pm-gtc-orders/backfill.mjs';
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-gtc-pending-cli-'));
  const row = accepted();
  const snapshot = { schemaVersion: 1, complete: true,
    snapshot: { isolation: 'repeatable-read', token: 'offline-cli-test', tables: ['orders', 'pm_gtc_executions', 'profiles'] },
    profiles: [{ id: OWNER }], orders: [], executions: [{ id: row.id, owner: row.owner,
      wallet_key: row.walletKey, active: !row.released, record: row, updated_at: String(row.createdAt) }] };
  const input = path.join(directory, 'snapshot.json'); const output = path.join(directory, 'result.json');
  fs.writeFileSync(input, JSON.stringify(snapshot));
  return { directory, input, output, snapshot };
}
const run = (args, env = {}) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8',
  env: { ...process.env, DATABASE_URL: 'postgres://production-secret@invalid.example/gamebet', ...env } });

describe('pending backfill CLI defaults and isolation', () => {
  it('default plans without connecting, leaking control payloads, or claiming execution', () => {
    const { input, output } = fixture(); const original = fs.readFileSync(input, 'utf8');
    const result = run(['--input', input, '--output', output], { PM_GTC_TEST_DATABASE_URL: 'postgres://test-secret@rds.example/gamebet' });
    expect(result.status).toBe(0);
    const report = JSON.parse(fs.readFileSync(output, 'utf8'));
    expect(report).toMatchObject({ mode: 'offline-plan', databaseConnected: false, productionDatabaseConnected: false,
      productionApplySupported: false, completed: false, receipts: [], counts: { 'insert-pending': 1 } });
    expect(fs.readFileSync(input, 'utf8')).toBe(original);
    expect(fs.existsSync(output + '.journal.jsonl')).toBe(false);
    expect(JSON.stringify(report) + result.stdout + result.stderr).not.toMatch(/test-wallet|test-secret|production-secret|execution_record/);
  });
  it.each(['--apply', '--url', '--execute', '--execute-isolated --execute-isolated'])('rejects unsupported execution option %s before producing any evidence', option => {
    const { input, output } = fixture();
    expect(run(['--input', input, '--output', output, ...option.split(' ')]).status).toBe(1);
    expect(fs.existsSync(output)).toBe(false);
  });
  it.each(['postgres://production-secret@rds.example/gamebet', 'postgres://postgres:test@127.0.0.1/changmen',
    'postgres://changmen_orders_phase2_test:test@127.0.0.1/changmen_orders_phase2_test_v1?host=rds.example'])('refuses unsafe database configuration without connecting or printing it: %s', url => {
    const { input, output } = fixture();
    const result = run(['--input', input, '--output', output, '--execute-isolated'], { PM_GTC_TEST_DATABASE_URL: url });
    expect(result.status).toBe(1); expect(fs.existsSync(output)).toBe(false);
    expect(result.stdout + result.stderr).not.toContain(url);
    expect(result.stdout + result.stderr).not.toContain('production-secret');
  });
  it('refuses incomplete snapshots, source conflicts and output overwrites', () => {
    const f = fixture(); fs.writeFileSync(f.input, JSON.stringify({ ...f.snapshot, complete: false }));
    expect(run(['--input', f.input, '--output', f.output]).status).toBe(1);
    expect(fs.existsSync(f.output)).toBe(false);
    f.snapshot.executions[0].record.owner = '00000000-0000-4000-8000-000000000099';
    fs.writeFileSync(f.input, JSON.stringify(f.snapshot));
    expect(run(['--input', f.input, '--output', f.output]).status).toBe(2);
    const original = fs.readFileSync(f.output, 'utf8');
    expect(run(['--input', f.input, '--output', f.output]).status).toBe(1);
    expect(fs.readFileSync(f.output, 'utf8')).toBe(original);
    expect(run(['--input', f.input, '--output', f.input]).status).toBe(1);
  });
});
