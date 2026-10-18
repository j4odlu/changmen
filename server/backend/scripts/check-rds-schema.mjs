#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkConfiguredRdsSchema } from "@changmen/db/maintenance/check-rds-schema.mjs";
export * from "@changmen/db/maintenance/check-rds-schema.mjs";

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkConfiguredRdsSchema().catch(error => { console.error("[rds] 失败:", error.message); process.exitCode = 1; });
}
