/**
 * RDS 连接池（@changmen/db 各 store 经 rds/common 或脚本直连）。
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPgClientConfig,
  getResolvedDatabaseUrl,
  initDatabaseUrl,
} from "./resolve_database_url.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let _pgPool = null;
let _logged = false;
const _clientErrorHandled = new WeakSet();

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function defaultApplicationName() {
  const cwd = process.cwd().replace(/\\/g, "/");
  if (cwd.includes("/server/match/matcher"))
    return "changmen-matcher";
  if (cwd.includes("/server/backend"))
    return "changmen-esport";
  if (cwd.includes("/server/value-bet"))
    return "changmen-value-bet";
  return "changmen";
}

function applicationName() {
  return String(
    process.env.DATABASE_APPLICATION_NAME
    || process.env.PM2_NAME
    || process.env.npm_package_name
    || defaultApplicationName(),
  ).replace(/[^\w.-]+/g, "_").slice(0, 63);
}

function requirePg() {
  const searchPaths = [
    path.join(__dirname, "..", "..", "apps", "backend", "node_modules"),
    path.join(__dirname, "..", "..", "node_modules"),
    path.join(__dirname, "..", "node_modules"),
  ];
  return require(require.resolve("pg", { paths: searchPaths }));
}

export function attachClientErrorHandler(client) {
  if (!client || _clientErrorHandled.has(client))
    return;
  _clientErrorHandled.add(client);
  const connectedAt = Date.now();
  const socket = client.connection?.stream;
  const path = { host: client.host, localAddress: socket?.localAddress, localPort: socket?.localPort,
    remoteAddress: socket?.remoteAddress, remotePort: socket?.remotePort };
  let lastError;
  client.on("error", (err) => {
    lastError = { code: err.code || "CONNECTION_ERROR", message: err.message };
    console.warn("[db] RDS client error:", JSON.stringify({ at: new Date().toISOString(),
      code: err.code || "CONNECTION_ERROR", message: err.message, backendPid: client.processID,
      connectionAgeMs: Date.now() - connectedAt, application: applicationName(), path }));
  });
  client.on("end", () => {
    // pg 主动 client.end()/池内到期淘汰会设置 _ending；只有意外断开才报警。
    // 活跃查询遇到 EOF 时 pg 会直接拒绝查询并发出 end，不一定再发 client.error。
    if (client._ending || client.connection?._ending) return;
    console.warn("[db] RDS unexpected disconnect:", JSON.stringify({ at: new Date().toISOString(),
      backendPid: client.processID, connectionAgeMs: Date.now() - connectedAt,
      application: applicationName(), path, ...(lastError || { code: "UNEXPECTED_END" }),
      total: _pgPool?.totalCount, idle: _pgPool?.idleCount, waiting: _pgPool?.waitingCount }));
  });
}

/** @param {string} [reason] 首次建池时的日志说明 */
export function getPgPool(reason = "") {
  const url = getResolvedDatabaseUrl();
  if (!url)
    return null;
  if (!_pgPool) {
    const { Pool } = requirePg();
    const max = envInt("DATABASE_POOL_MAX", 12);
    const connectionTimeoutMillis = envInt("DATABASE_POOL_CONNECT_TIMEOUT_MS", 10000);
    const statementTimeoutMs = envInt("DATABASE_STATEMENT_TIMEOUT_MS", 30000);
    const idleInTransactionSessionTimeoutMs = envInt(
      "DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS",
      30000,
    );
    const queryTimeoutMs = envInt("DATABASE_QUERY_TIMEOUT_MS", statementTimeoutMs + 5000);
    const idleTimeoutMillis = envInt("DATABASE_POOL_IDLE_TIMEOUT_MS", 30000);
    const maxLifetimeSeconds = envInt("DATABASE_POOL_MAX_LIFETIME_SEC", 600);
    _pgPool = new Pool({
      ...buildPgClientConfig(url, connectionTimeoutMillis),
      max,
      idleTimeoutMillis,
      maxLifetimeSeconds,
      // 云上 NAT/RDS 常掐死空闲 TCP；无 keepalive 时池内连接变死连接，随后雪崩
      keepAlive: true,
      keepAliveInitialDelayMillis: envInt("DATABASE_POOL_KEEPALIVE_DELAY_MS", 10_000),
      query_timeout: queryTimeoutMs,
      statement_timeout: statementTimeoutMs,
      idle_in_transaction_session_timeout: idleInTransactionSessionTimeoutMs,
      application_name: applicationName(),
    });
    _pgPool.on("connect", attachClientErrorHandler);
    _pgPool.on("error", (err) => {
      console.warn("[db] RDS idle client error:", JSON.stringify({ at: new Date().toISOString(),
        code: err.code || "CONNECTION_ERROR", message: err.message,
        total: _pgPool.totalCount, idle: _pgPool.idleCount, waiting: _pgPool.waitingCount }));
    });
    if (!_logged) {
      _logged = true;
      const tag = reason ? ` (${reason})` : "";
      console.log(
        `[db] RDS 连接池已就绪${tag} max=${max} connectTimeout=${connectionTimeoutMillis}ms statementTimeout=${statementTimeoutMs}ms idleTxTimeout=${idleInTransactionSessionTimeoutMs}ms`,
      );
    }
  }
  return _pgPool;
}

/** 启动前解析内网/外网 DATABASE_URL（start-db 等入口调用） */
export async function ensurePgPoolReady() {
  await initDatabaseUrl();
  return getPgPool();
}
