#!/usr/bin/env node
/**
 * OB 下注 provider 离线契约：接口面 + A8 对齐的 venue API 路径（无需真实 OB 账号）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROVIDER_PATH = path.resolve(__dirname, "@changmen/venue-browser/adapter/ob/bet.ts");
const MQTT_PATH = path.resolve(__dirname, "@changmen/venue-browser/adapter/ob/mqtt.ts");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function main() {
  const provider = fs.readFileSync(PROVIDER_PATH, "utf8");
  const mqtt = fs.readFileSync(MQTT_PATH, "utf8");

  for (const name of ["getBalance", "getOrders", "checkBet", "betting"]) {
    assert(provider.includes(`${name}(`), `obProvider 缺方法 ${name}`);
  }
  assert(provider.includes("export const obProvider"), "obProvider 未导出");

  const requiredPaths = [
    "/game/balance",
    "/game/bet",
    "/game/orderList",
    "/game/member/heartbeat",
    "/game/odd/updateType",
  ];
  for (const p of requiredPaths) {
    assert(provider.includes(p), `obProvider 未引用 ${p}`);
  }

  assert(provider.includes("secret_key"), "obProvider 缺 secret_key 签名");
  assert(provider.includes("Odds error") || provider.includes("赔率错误"), "obProvider 缺赔率重试分支");
  assert(provider.includes("请勿重复提交"), "obProvider 缺重复提交重试");

  const marketHandlers = [
    "/market/oddsUpdate/",
    "/market/statusUpdate/",
    "/market/suspended/",
  ];
  for (const t of marketHandlers) {
    assert(mqtt.includes(`case "${t}"`), `mqtt 缺 handler ${t}`);
  }

  assert(mqtt.includes("/odd/insert/"), "mqtt 应订阅 /odd/insert");
  assert(!mqtt.includes('case "/odd/suspended/"'), "mqtt 不应处理 /odd/suspended（与 A8 一致）");

  console.log("[ob-provider] 契约校验 PASS", {
    methods: ["getBalance", "getOrders", "checkBet", "betting"],
    venueApis: requiredPaths.length,
    mqttMarketHandlers: marketHandlers.length,
  });
}

try {
  main();
} catch (e) {
  console.error("[ob-provider] FAIL", e.message);
  process.exit(1);
}
