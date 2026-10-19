/**
 * A8 行级复刻锁定测试（OB yYe / RAY vYe / PB PZe+Zn）。
 * 改 bet.ts / transport.ts / auth.ts / BetOption / BetResult 若破坏对齐，此处或子模块测试应失败。
 *
 * 有意不对齐 A8 的边界（冻结，不再当 bug 修）：
 * - RAY getOrders 对空 result 做防护返回 []（A8 会抛错）
 * - RAY 无盘口时用 row?. 避免抛错（A8 模板在 !o 时可能抛错）
 * - PB 无扩展时 bridge 抛错 / transport 返回 undefined（A8 Zn 返回 undefined）
 */
import { describe, expect, it } from "vitest";
import { buildPbAuthHeaders } from "./pb/auth";
import { pbGatewayUrl } from "./pb/transport";
import { BetResult } from "@changmen/client-core/models/betResult";

describe("A8 bet parity lock", () => {
  it("PB Ly: gateway+path 直接拼接", () => {
    expect(pbGatewayUrl({ gateway: "https://x.com" }, "/api")).toBe("https://x.com/api");
  });

  it("PB k0: 固定 515 五字段", () => {
    const token = JSON.stringify({
      "x-app-data": JSON.stringify({ BrowserSessionId_515: "s" }),
      custid_515: "u",
      "v-hucode": "h",
      token: JSON.stringify({ "X-U": "must-not-leak", "X-SLID": "-1" }),
    });
    const h = buildPbAuthHeaders({ token } as never);
    expect(Object.keys(h!)).toEqual([
      "x-app-data",
      "x-browser-session-id-515",
      "x-custid-515",
      "v-hucode",
      "x-requested-with",
    ]);
  });

  it("uo: message 不兜底", () => {
    expect(new BetResult("OB", true, "").message).toBe("");
    expect(new BetResult("RAY", false, undefined).message).toBeUndefined();
  });
});
