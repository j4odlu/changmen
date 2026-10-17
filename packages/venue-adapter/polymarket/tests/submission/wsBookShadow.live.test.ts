/** [changmen 扩展] 显式启动的公开只读直连实测。没有账号、签名器或订单提交依赖。 */
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import WebSocket from "ws";
import { expect, test } from "vitest";
import { DirectBookFeed } from "../helpers/directBookFeed";
import { OwnedRuntimeFixture as WsBookShadowRuntime } from "../helpers/ownedBookFixtures";

test.skipIf(process.env.PM_WS_SHADOW_LIVE !== "1")("standalone adapter reference (not production passive path): observes official snapshots, deltas, heartbeat and periodic resnapshot with read-only HTTP comparison", async () => {
  const token = process.env.PM_WS_SHADOW_TOKEN;
  if (!token || !/^\d+$/.test(token)) throw new Error("PM_WS_SHADOW_TOKEN must identify an active public market");
  const startedAt = new Date().toISOString();
  const runtime = new WsBookShadowRuntime(() => true, {
    feedFactory: options => new DirectBookFeed({ ...options, socket: url => new WebSocket(url, { handshakeTimeout: 8_000 }) as unknown as globalThis.WebSocket }),
    fetchBook: (asset, signal) => new Promise((resolve, reject) => {
      const req = https.get(`https://clob.polymarket.com/book?token_id=${asset}`, { agent: false, signal }, response => {
        let body = "";
        response.on("data", chunk => { body += chunk.toString(); if (body.length > 1_000_000) req.destroy(new Error("size limit")); });
        response.on("error", reject);
        response.on("end", () => {
          try { if (response.statusCode !== 200) throw new Error(`HTTP ${response.statusCode}`); resolve(JSON.parse(body)); }
          catch (error) { reject(error); }
        });
      });
      req.on("error", reject);
    }),
  });
  try {
    runtime.setAssets([token]);
    await new Promise(resolve => setTimeout(resolve, 72_000));
    const report = { startedAt, finishedAt: new Date().toISOString(), token,
      route: "Node native HTTPS agent:false + ws without proxy; not a browser CORS or user-line benchmark",
      submittedOrders: 0, accountUsed: false, report: runtime.report() };
    const output = path.resolve(process.cwd(), "../../output/pm-ws-shadow-live.json");
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2));
    expect(report.report.counters.snapshot_received ?? 0).toBeGreaterThanOrEqual(2);
    expect(report.report.counters.periodic_resnapshot ?? 0).toBeGreaterThanOrEqual(1);
    expect(report.report.samples.some(sample => sample.source === "probe")).toBe(true);
    expect(report.report.activeSupported).toBe(false);
  } finally { runtime.stop(); }
}, 85_000);
