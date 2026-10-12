/** [changmen 扩展] 只允许专用、可丢弃的本机测试库，绝不推断应用凭证。 */
export const TEST_DATABASE = "changmen_orders_phase2_test_v1";
export const TEST_ROLE = "changmen_orders_phase2_test";
export const TEST_MARKER = "changmen:pm-gtc-orders:phase2:disposable:v1";
export const EXECUTION_TOKEN = "phase2-isolated-postgres-v1";

export function isolatedConnection(urlText, token) {
  if (token !== EXECUTION_TOKEN)
    throw new Error("隔离 PostgreSQL 测试需要显式执行入口");
  let url;
  try { url = new URL(urlText); }
  catch { throw new Error("PM_GTC_TEST_DATABASE_URL 无效或缺失"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.pathname !== `/${TEST_DATABASE}` || decodeURIComponent(url.username) !== TEST_ROLE
    || url.search || url.hash || (url.port && (!/^\d+$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65535))) {
    throw new Error("只允许专用本机 PostgreSQL 测试库和测试角色，禁止 URL 参数覆盖");
  }
  return { connectionString: urlText, ssl: false, max: 8, connectionTimeoutMillis: 3000, statement_timeout: 8000, lock_timeout: 3000, application_name: "pm-gtc-phase2-integration" };
}

export async function verifyIsolatedDatabase(pool) {
  const result = await pool.query(`SELECT current_database() AS database, current_user AS role,
    host(inet_server_addr()) AS address, current_setting('server_version_num')::int AS version,
    shobj_description(d.oid,'pg_database') AS marker, r.rolsuper, r.rolcreatedb, r.rolcreaterole
    FROM pg_database d JOIN pg_roles r ON r.rolname=current_user WHERE d.datname=current_database()`);
  const row = result.rows[0];
  if (!row || row.database !== TEST_DATABASE || row.role !== TEST_ROLE || row.marker !== TEST_MARKER
    || !["127.0.0.1", "::1"].includes(row.address) || !Number.isInteger(row.version) || row.version < 140000
    || row.rolsuper !== false || row.rolcreatedb !== false || row.rolcreaterole !== false) {
    throw new Error("测试库身份、角色、标记或 PostgreSQL 版本验证失败");
  }
  return { database: row.database, role: row.role, address: row.address, version: row.version, marker: row.marker };
}
