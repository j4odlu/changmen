import { mkdirSync, openSync, writeSync, fsyncSync, closeSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { RECONCILE_TABLES } from './reconcile-rds-schema.mjs';

function writeAll(fd, data) {
  let offset = 0;
  while (offset < data.length) {
    const written = writeSync(fd, data, offset, data.length - offset);
    if (written <= 0) throw new Error('Backup write made no progress');
    offset += written;
  }
}

/** Caller holds all three table locks; backup and fingerprints share that state.
 * JSON text is produced by PostgreSQL, preserving bigint/JSON numeric precision.
 * Directory must be new. Backups stay on the database administration host.
 */
export function createReconciliationBackup(directory) {
  return async (client, manifest) => {
    mkdirSync(directory, { mode: 0o700 });
    const files = {};
    for (const table of RECONCILE_TABLES) {
      const filename = path.join(directory, table + '.jsonl');
      const fd = openSync(filename, 'wx', 0o600), hash = createHash('sha256');
      let rows = 0, bytes = 0;
      try {
        await client.query(`DECLARE reconciliation_backup NO SCROLL CURSOR FOR SELECT row_to_json(t)::text AS row FROM public.${table} t`);
        while (true) {
          const batch = (await client.query('FETCH 500 FROM reconciliation_backup')).rows;
          if (!batch.length) break;
          const chunk = batch.map(r => r.row).join('\n') + '\n';
          const data = Buffer.from(chunk);
          writeAll(fd, data);
          hash.update(data); bytes += data.length; rows += batch.length;
        }
        await client.query('CLOSE reconciliation_backup');
        fsyncSync(fd);
      } finally { closeSync(fd); }
      if (String(rows) !== manifest.before.tables[table].rows) throw new Error(`Backup row count mismatch: ${table}`);
      const sha256 = hash.digest('hex');
      if (createHash('sha256').update(readFileSync(filename)).digest('hex') !== sha256) throw new Error(`Backup readback mismatch: ${table}`);
      files[table] = { rows, bytes, sha256 };
    }
    const manifestFile = path.join(directory, 'manifest.json');
    const manifestBytes = Buffer.from(JSON.stringify({ ...manifest, files, createdAt: new Date().toISOString() }, null, 2) + '\n');
    const fd = openSync(manifestFile, 'wx', 0o600);
    try {
      writeAll(fd, manifestBytes);
      fsyncSync(fd);
    } finally { closeSync(fd); }
    if (!readFileSync(manifestFile).equals(manifestBytes)) throw new Error('Backup manifest readback mismatch');
    // Ensure directory entries are durable on the production Linux host.
    if (process.platform !== 'win32') {
      const directoryFd = openSync(directory, 'r');
      try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
    }
    return { directory, files };
  };
}
