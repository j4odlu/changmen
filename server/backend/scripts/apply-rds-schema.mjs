#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runConfiguredRdsSchema } from "@changmen/db/maintenance/apply-rds-schema.mjs";
export * from "@changmen/db/maintenance/apply-rds-schema.mjs";

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runConfiguredRdsSchema().catch(error => { console.error("[rds] 失败:", error.message); process.exitCode = 1; });
}
