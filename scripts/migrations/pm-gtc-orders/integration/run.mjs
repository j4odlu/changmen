import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXECUTION_TOKEN, isolatedConnection, TEST_DATABASE, TEST_ROLE } from "./guard.mjs";

import { gitSource } from "../../../verification/fok-exact-boundaries.mjs";
import { retirementBase } from "../../../verification/gtc-compat-retirement.mjs";
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && !["--plan", "--execute-isolated"].includes(args[0]))) {
  console.error("用法: node scripts/migrations/pm-gtc-orders/integration/run.mjs [--plan | --execute-isolated]");
  process.exitCode = 1;
}
else if (args[0] !== "--execute-isolated") {
  process.stdout.write(`${JSON.stringify({ mode: "plan", databaseConnected: false, sqlExecuted: false, testDatabase: TEST_DATABASE, testRole: TEST_ROLE, urlEnv: "PM_GTC_TEST_DATABASE_URL", steps: ["另行授权后创建全新隔离测试库", "验证地址/库名/非特权角色/库标记", "执行最小测试基表与原阶段二 DDL", "执行真实 writer、并发及故障验收", "记录全部结果，保留失败证据"], noProductionCredentials: true, noAutomaticDrop: true, databaseIntegrationAccepted: false }, null, 2)}\n`);
}
else {
  try {
    isolatedConnection(process.env.PM_GTC_TEST_DATABASE_URL, EXECUTION_TOKEN);
    const root = fileURLToPath(new URL("../../../../", import.meta.url));
    const cli = path.join(root, "node_modules/vitest/vitest.mjs");
    if (!fs.existsSync(cli))
      throw new Error("缺少本地 Vitest，请使用已安装的仓库依赖");
    // 只运行专用文件；主动剔除应用/其他测试凭证，不能启用 auth 等真实数据库测试。
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/DATABASE|^PG[A-Z_]|^ORDERS_EXECUTION_COMPAT$/.test(key)));
    env.PM_GTC_TEST_DATABASE_URL = process.env.PM_GTC_TEST_DATABASE_URL;
    env.PM_GTC_TEST_EXECUTION_TOKEN = EXECUTION_TOKEN;
    const evidence = path.join(root, "output", "pm-gtc-phase2-postgres-integration", `${Date.now()}-${crypto.randomUUID()}`);
    fs.mkdirSync(evidence, { recursive: true });
    env.PM_GTC_TEST_EVIDENCE_DIR = evidence;
    // [changmen 扩展] 当前代码不再运行旧模式；这里只复验不可变 Git 中的历史存储实现。
    const hash = name => crypto.createHash("sha256").update(name.startsWith("rds/rds/") ? gitSource(retirementBase,name) : fs.readFileSync(path.join(root, name))).digest("hex");
    const sources = ["scripts/migrations/pm-gtc-orders/phase2-schema.sql", "scripts/migrations/pm-gtc-orders/phase2-rollback.sql", "scripts/migrations/pm-gtc-orders/integration/postgres.integration.mjs", "scripts/migrations/pm-gtc-orders/integration/bootstrap.sql", "scripts/migrations/pm-gtc-orders/backfill-pending.mjs", "scripts/migrations/pm-gtc-orders/backfill.mjs", "scripts/migrations/pm-gtc-orders/plan.mjs", "rds/rds/orders_execution_compat.js", "rds/rds/orders_store.js", "rds/rds/orderModes/gtc/pm_gtc_store.js", "rds/rds/orderModes/gtc/pm_gtc_orders_store.js"];
    const hashes = Object.fromEntries(sources.map(name => [name, hash(name)]));
    const result = spawnSync(process.execPath, [cli, "run", "--config", "scripts/migrations/pm-gtc-orders/integration/postgres.config.mjs", "--reporter=default", "--reporter=json", `--outputFile=${path.join(evidence, "vitest.json")}`], { cwd: root, env, stdio: "inherit", shell: false });
    let report;
    if (fs.existsSync(path.join(evidence, "vitest.json")))
      report = JSON.parse(fs.readFileSync(path.join(evidence, "vitest.json"), "utf8"));
    const sourceUnchanged = sources.every(name => hash(name) === hashes[name]);
    const accepted = result.status === 0 && report?.success === true && report.numTotalTests === 64
      && report.numPassedTests === 64 && report.numPendingTests === 0 && sourceUnchanged;
    fs.writeFileSync(path.join(evidence, "acceptance.json"), JSON.stringify({ capturedAt: new Date().toISOString(), mode: "isolated-historical-postgres", historicalCommit: retirementBase, testDatabase: TEST_DATABASE, testRole: TEST_ROLE, expectedCases: 64, passedCases: report?.numPassedTests ?? 0, skippedCases: report?.numPendingTests ?? null, sourceHashes: hashes, sourceUnchanged, databaseIntegrationAccepted: accepted, productionDatabaseVerified: false, fullPhase2Accepted: false, fullReleaseAccepted: false, committed: false, deployed: false, exitCode: result.status ?? 1 }, null, 2));
    if (result.error)
      throw new Error("无法启动隔离测试进程");
    process.exitCode = accepted ? 0 : 1;
  }
  catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
