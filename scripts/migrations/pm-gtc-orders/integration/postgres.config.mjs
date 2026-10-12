import { defineConfig } from "vitest/config";

// 独立文件名/入口，不被默认 *.test.* 发现；环境变量存在也不能自动连接数据库。
export default defineConfig({ test: {
  include: ["scripts/migrations/pm-gtc-orders/integration/postgres.integration.mjs"],
  fileParallelism: false,
  maxWorkers: 1,
  testTimeout: 20000,
  hookTimeout: 20000,
} });
