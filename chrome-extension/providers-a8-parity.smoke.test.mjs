/**
 * A8 插件 2.0.149 凭证馆 Check/GetConfig 对齐清单（相对 A8/A8插件/content.js）
 * 运行：node providers-a8-parity.smoke.test.mjs
 */
import assert from "node:assert/strict";
import { PLATFORM_LIST, PLATFORMS } from "./src/content/platforms.js";

const A8_ORDER = [
  "OB",
  "RAY",
  "IM",
  "TF",
  "IA",
  "SABA",
  "PB",
  "IMT",
  "HGA",
  "HG",
  "Stake",
];

for (const id of A8_ORDER) {
  assert.ok(PLATFORM_LIST.includes(id), `missing A8 platform ${id}`);
}
assert.deepEqual(
  PLATFORM_LIST.slice(0, A8_ORDER.length),
  A8_ORDER,
  "A8 馆顺序应与 A8 Object.values(o) 一致",
);

/** 文档化：已核对与 A8 同构 / 有意扩展 */
const PARITY = {
  OB: "esport Check/GetConfig ≈ A8；+ sport / 父页 iframe [changmen]",
  RAY: "[A8 可证实] 旧站 storage 顺序 + configv4 网关数组；[changmen 扩展] 官网 Vue HTTP 会话、复制前余额验证、Bearer 去重、失败提示",
  IM: "同 A8",
  TF: "同 A8",
  IA: "同 A8",
  SABA: "同 A8",
  PB: "经典 path+x-app-data 同 A8；+/sports 会话检测 [changmen]；data UTF-8 btoa；非 515 复制前校验 X-U [changmen]",
  IMT: "同 A8",
  HGA: "Check/GetConfig 同 A8（图标 class 换名）；注单轮询暂停 no-op",
  HG: "同 A8（图标 class 换名）",
  Stake: "同 A8（cookie session）",
  Dex: "[changmen 扩展]",
  Polymarket: "[changmen 扩展]",
};

assert.equal(Object.keys(PARITY).sort().join(), Object.values(PLATFORMS).slice().sort().join());
console.log("providers-a8-parity: ok");
for (const [k, v] of Object.entries(PARITY)) {
  console.log(`  ${k}: ${v}`);
}
