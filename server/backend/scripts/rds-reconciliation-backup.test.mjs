import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const faults = vi.hoisted(() => ({ mode: 'partial' }));
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, readFileSync: (filename, ...args) => {
    const data = actual.readFileSync(filename, ...args);
    if (faults.mode === 'corrupt' && String(filename).endsWith('manifest.json')) return Buffer.from('corrupt manifest');
    return data;
  }, writeSync: (fd, data, offset = 0, length) => {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (faults.mode === 'zero') return 0;
    if (faults.mode === 'error') throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    return actual.writeSync(fd, buffer, offset, Math.min(length ?? buffer.length, 17));
  } };
});
import { createReconciliationBackup } from './rds-reconciliation-backup.mjs';
import { RECONCILE_TABLES } from './reconcile-rds-schema.mjs';
const directories = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
function fixture(mode) {
  faults.mode = mode;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changmen-backup-write-test-')); directories.push(root);
  const directory = path.join(root, 'backup');
  // Preserve a JSON number above JS safe integer and multibyte text byte-for-byte.
  const row = '{"id":9007199254740993,"title":"测试备份完整性"}';
  const manifest = { before: { tables: Object.fromEntries(RECONCILE_TABLES.map(t => [t, { rows: '1' }])) }, migration: 'synthetic' };
  let fetched = false;
  const client = { query: vi.fn(async sql => {
    if (sql.startsWith('DECLARE')) fetched = false;
    if (sql.startsWith('FETCH') && !fetched) { fetched = true; return { rows: [{ row }] }; }
    return { rows: [] };
  }) };
  return { directory, row, manifest, client };
}
describe('durable reconciliation backup I/O failures', () => {
  it('handles partial writes for both JSONL data and the restore manifest', async () => {
    const { directory, row, manifest, client } = fixture('partial');
    const receipt = await createReconciliationBackup(directory)(client, manifest);
    for (const table of RECONCILE_TABLES) expect(fs.readFileSync(path.join(directory, table + '.jsonl'), 'utf8')).toBe(row + '\n');
    const saved = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
    expect(saved.before).toEqual(manifest.before);
    expect(saved.files).toEqual(receipt.files);
  });
  it.each([['zero', /write made no progress/], ['error', /disk full/]])('rejects %s writes without returning a successful backup receipt', async (mode, message) => {
    const { directory, manifest, client } = fixture(mode);
    await expect(createReconciliationBackup(directory)(client, manifest)).rejects.toThrow(message);
    expect(fs.existsSync(path.join(directory, 'manifest.json'))).toBe(false);
  });
  it('rejects a damaged manifest during readback', async () => {
    const { directory, manifest, client } = fixture('corrupt');
    await expect(createReconciliationBackup(directory)(client, manifest)).rejects.toThrow('manifest readback mismatch');
  });
});
