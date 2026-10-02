import { readFileSync } from 'node:fs';
import { loadChangmenEnv } from '@changmen/storage/load_env.js';
import { ensurePgPoolReady, getPgPool } from '@changmen/db';
loadChangmenEnv();
await ensurePgPoolReady();
const pool = getPgPool();
await pool.query(readFileSync(new URL('../../../../db/schema/client_certificates.sql', import.meta.url), 'utf8'));
console.log('Client certificate registry schema ready; account/order migrations not executed');
await pool.end();
