/**
 * RDS 连接串解析：内网 + 外网可同时写在 .env，启动时自动选可用地址。
 *
 *   DATABASE_URL_PUBLIC=...    # 本机 / 外网
 *   DATABASE_URL_INTERNAL=...  # VPS 同 VPC 内网
 *   DATABASE_RDS_TARGET=auto|internal|public  # 默认 auto
 *   DATABASE_URL=...           # 单独配置时仍兼容；与 PUBLIC/INTERNAL 同时存在时作最后回退
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let _resolvedUrl = null;
let _resolvedLabel = null;

function requirePg() {
  const searchPaths = [
    path.join(__dirname, "..", "apps", "backend", "node_modules"),
    path.join(__dirname, "..", "node_modules"),
    path.join(__dirname, "..", "server", "node_modules"),
  ];
  return require(require.resolve("pg", { paths: searchPaths }));
}

/** 与 pg_pool 一致 */
export function wantsPgSsl() {
  const flag = String(process.env.DATABASE_SSL || "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "require";
}

export function buildPgClientConfig(url, connectionTimeoutMillis = 2500) {
  return {
    connectionString: url,
    ssl: wantsPgSsl() ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis,
  };
}

function trimUrl(v) {
  return String(v || "").trim();
}

export function getDatabaseUrlCandidates() {
  return {
    explicit: trimUrl(process.env.DATABASE_URL),
    internal: trimUrl(process.env.DATABASE_URL_INTERNAL),
    public: trimUrl(process.env.DATABASE_URL_PUBLIC),
  };
}

export function hasDatabaseUrlConfig() {
  const c = getDatabaseUrlCandidates();
  return !!(c.explicit || c.internal || c.public);
}

export function getResolvedDatabaseUrl() {
  return _resolvedUrl || trimUrl(process.env.DATABASE_URL) || null;
}

export function getResolvedDatabaseLabel() {
  return _resolvedLabel || (trimUrl(process.env.DATABASE_URL) ? "DATABASE_URL" : "");
}

async function probeUrl(url, timeoutMs = 2500) {
  const { Client } = requirePg();
  const client = new Client(buildPgClientConfig(url, timeoutMs));
  client.on("error", (err) => {
    console.warn("[db] RDS probe client error:", err.message);
  });
  try {
    await client.connect();
    await client.query("SELECT 1");
    await client.end();
    return true;
  }
  catch {
    try {
      await client.end();
    }
    catch {
      /* ignore */
    }
    return false;
  }
}

function applyResolved(url, label) {
  _resolvedUrl = url;
  _resolvedLabel = label;
  process.env.DATABASE_URL = url;
  return url;
}

/**
 * 解析并写入 process.env.DATABASE_URL（幂等）。
 * @returns {Promise<string|null>}
 */
export async function initDatabaseUrl() {
  if (_resolvedUrl)
    return _resolvedUrl;

  const { explicit, internal, public: pub } = getDatabaseUrlCandidates();
  const target = trimUrl(process.env.DATABASE_RDS_TARGET).toLowerCase() || "auto";

  if (explicit && !internal && !pub) {
    return applyResolved(explicit, "DATABASE_URL");
  }

  if (target === "internal" && internal) {
    console.log("[db] RDS 使用内网 (DATABASE_RDS_TARGET=internal)");
    return applyResolved(internal, "internal");
  }
  if (target === "public" && pub) {
    console.log("[db] RDS 使用外网 (DATABASE_RDS_TARGET=public)");
    return applyResolved(pub, "public");
  }

  if (target !== "auto" && target !== "internal" && target !== "public") {
    console.warn(`[db] 未知 DATABASE_RDS_TARGET=${target}，按 auto 处理`);
  }

  if (internal && (await probeUrl(internal))) {
    console.log("[db] RDS 使用内网 DATABASE_URL_INTERNAL (auto)");
    return applyResolved(internal, "internal (auto)");
  }
  if (pub && (await probeUrl(pub))) {
    console.log("[db] RDS 使用外网 DATABASE_URL_PUBLIC (auto)");
    return applyResolved(pub, "public (auto)");
  }
  if (explicit && explicit !== internal && explicit !== pub && (await probeUrl(explicit))) {
    console.log("[db] RDS 使用 DATABASE_URL (auto)");
    return applyResolved(explicit, "DATABASE_URL (auto)");
  }
  if (explicit && explicit !== internal) {
    console.log("[db] RDS 使用 DATABASE_URL（内网不可达，本机开发）");
    return applyResolved(explicit, "DATABASE_URL");
  }
  if (internal) {
    console.warn(
      "[db] 内网不可达且无可用外网地址，仍使用 DATABASE_URL_INTERNAL（本机请配置 DATABASE_URL_PUBLIC 或 DATABASE_RDS_TARGET=public）",
    );
    return applyResolved(internal, "internal (fallback)");
  }
  return null;
}
