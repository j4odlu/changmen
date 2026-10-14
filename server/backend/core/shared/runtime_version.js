/** [changmen 扩展] 运行身份是模块加载时的快照；后续 Git 更新不能冒充进程重启。 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { getPgPool } from "@changmen/db";
import { captureRuntimeVersion, readSourceVersion } from "@changmen/storage/runtime_version.js";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
export const backendRuntimeVersion = captureRuntimeVersion(path.resolve(root), "backend");
const schemaSql = `SELECT c.relname,
  (SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'required',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
   FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns,
  (SELECT jsonb_agg(pg_get_constraintdef(k.oid) ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid=c.oid) AS constraints,
  (SELECT jsonb_agg(jsonb_build_object('definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid) ORDER BY i.indexrelid::regclass::text) FROM pg_index i WHERE i.indrelid=c.oid) AS indexes
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname`;
export function createRuntimeVersionReader({ running, source, pool, now = Date.now }) {
  let schema, schemaAt = 0, pending;
  async function database() {
    if (schema && now() - schemaAt < 60000) return schema;
    if (pending) return pending;
    const task = (async () => {
      const base = { migrationVersion: null, migrationTracking: "untracked" };
      try {
        const db = pool();
        if (!db) return { ...base, status: "unavailable", schemaFingerprint: null };
        const result = await db.query({ text: schemaSql, query_timeout: 1500 });
        return { ...base, status: "observed", schemaFingerprint: createHash("sha256").update(JSON.stringify(result.rows)).digest("hex"), observedAt: new Date(now()).toISOString() };
      } catch { return { ...base, status: "unavailable", schemaFingerprint: null }; }
    })();
    pending = task;
    try { schema = await task; schemaAt = now(); return schema; }
    finally { if (pending === task) pending = undefined; }
  }
  return async () => {
    let workspace = null;
    try { workspace = source(); } catch { /* identity failure never exposes paths or errors */ }
    return { backend: running, workspace, restartRequired: workspace?.sourceFingerprint && running.sourceFingerprint ? running.sourceFingerprint !== workspace.sourceFingerprint : null, database: await database() };
  };
}
export const readRuntimeVersion = createRuntimeVersionReader({
  running: backendRuntimeVersion, source: () => readSourceVersion(path.resolve(root), "backend"), pool: getPgPool,
});
