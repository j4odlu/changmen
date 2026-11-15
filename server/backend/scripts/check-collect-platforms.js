#!/usr/bin/env node

/**
 * 采集平台配置审计 + 可选 live 探针
 *
 * 用法:
 *   npm run check:collect
 *   npm run check:collect -- --probe
 *   npm run check:collect -- --json
 */

import fs from "node:fs";
import path from "node:path";
import { ESPORT_DATA_DIR } from "../core/shared/storage_paths.js";
import store from "../core/esport-api/store.js";
import { handleEsportRequest } from "../core/esport-api/router.js";
import { requirePlatform } from "../core/shared/adapter_paths.js";
import { getPlatformRules, getDefaultMarketCode } from "@changmen/shared/catalog/market_catalog";

const { getRayA8CollectCredentials } = requirePlatform(
  "RAY", "node",
  "collect_credentials.js",
);

const ALL_PLATFORMS = [
  "OB",
  "IM",
  "RAY",
  "TF",
  "IA",
  "SABA",
  "XBet",
  "PB",
  "IMT",
  "HG",
  "Stake",
  "Dex",
  "Polymarket",
  "Limitless",
  "SXBet",
  "Azuro",
  "PredictFun",
];

/** 与 gamebet_frontend collectors 对齐的凭证需求 */
const SPEC = {
  OB: { needsGateway: true, needsToken: true, note: "HTTP game/index + MQTT 直连" },
  RAY: { needsGateway: true, needsToken: true, note: "HTTP match/odds（API 强制 A8 写死凭证）" },
  TF: { needsGateway: true, needsToken: true, note: "WS auth + /api/v8/events" },
  IA: { needsGateway: true, needsToken: false, note: "Socket.IO + HTTP" },
  PB: { needsGateway: true, needsToken: true, note: "嵌套 cookie/token JSON" },
  IMT: { needsGateway: true, needsToken: true, note: "POST delta/full" },
  SABA: { needsGateway: true, needsToken: true, note: "页面 path token + WS" },
  Stake: { needsGateway: true, needsToken: true, note: "GraphQL x-access-token" },
  IM: { needsGateway: true, needsToken: false, note: "A8 Socket 频道 IM + 插件" },
  XBet: { needsGateway: true, needsToken: false, note: "A8 Socket 频道 XBet + 插件" },
  HG: { needsGateway: false, needsToken: false, note: "占位，无赔率采集" },
  Dex: { needsGateway: false, needsToken: false, note: "plugin_http paused" },
  Polymarket: { needsGateway: false, needsToken: false, note: "VPS collector + MarketIndex" },
  Limitless: { needsGateway: false, needsToken: false, note: "plugin_http_ws" },
  SXBet: { needsGateway: false, needsToken: false, note: "paused VPS collector + market hub" },
  Azuro: { needsGateway: false, needsToken: false, note: "paused HTTP/WS collector" },
  PredictFun: { needsGateway: false, needsToken: false, note: "VPS collector + market hub" },
};

const PLATFORMS_FILE = path.join(ESPORT_DATA_DIR, "platforms.json");
const USER_KV_FILE = path.join(ESPORT_DATA_DIR, "user_kv.json");

function parseArgs(argv) {
  return {
    probe: argv.includes("--probe"),
    json: argv.includes("--json"),
    help: argv.includes("-h") || argv.includes("--help"),
  };
}

function mask(value) {
  if (!value) return "";
  const s = String(value);
  if (s.length <= 12) return `${s.slice(0, 4)}…`;
  return `${s.slice(0, 8)}…${s.slice(-4)} (${s.length})`;
}

function loadPlatformsJson() {
  try {
    return JSON.parse(fs.readFileSync(PLATFORMS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function loadAccounts() {
  try {
    const kv = JSON.parse(fs.readFileSync(USER_KV_FILE, "utf8"));
    return JSON.parse(kv.ACCOUNT || "[]");
  } catch {
    return [];
  }
}

/** 对齐 esport-api/router.js Client_GetCollectPlatform */
function effectiveCollectPlatform(provider) {
  const row = store.getPlatform(provider);
  const catalogBetName =
    getPlatformRules(provider, getDefaultMarketCode())?.betName || ".*";

  if (!row) {
    return {
      source: "missing",
      gateway: "",
      token: "",
      betName: catalogBetName,
      inPlatformsJson: false,
    };
  }

  const betName = row.betName && row.betName !== ".*" ? row.betName : catalogBetName;
  let gateway = row.gateway || "";
  let token = row.token || "";

  if (String(provider) === "Stake") {
    gateway = row.gateway || row.apiUrl || "https://stake.com";
    token = row.accessToken || row.token || "";
  }

  if (String(provider).toUpperCase() === "RAY") {
    const a8 = getRayA8CollectCredentials();
    return {
      source: "platform_node/ray/collect_credentials.js",
      gateway: a8.gateway,
      token: a8.token,
      betName: a8.betName || betName,
      inPlatformsJson: Boolean(loadPlatformsJson().RAY),
    };
  }

  return {
    source: "platforms.json",
    gateway,
    token,
    betName,
    inPlatformsJson: Boolean(loadPlatformsJson()[provider]),
    referer: row.referer,
    games: Array.isArray(row.games) ? row.games.length : 0,
  };
}

function configStatus(provider, eff) {
  const spec = SPEC[provider];
  const gwOk = !spec.needsGateway || Boolean(eff.gateway);
  const tokOk = !spec.needsToken || Boolean(eff.token);
  if (gwOk && tokOk) return "OK";
  if (!spec.needsGateway && !spec.needsToken) return "OK";
  return "MISSING";
}

function mockEsportCall(action, body, token) {
  const raw = JSON.stringify({ action, ...body });
  const listeners = { data: [], end: [], error: [] };
  const req = {
    method: "POST",
    url: `/esport/${action}`,
    headers: { "content-type": "application/json", token: token || "" },
    on(ev, fn) {
      listeners[ev]?.push(fn);
    },
    _start() {
      listeners.data.forEach((fn) => fn(Buffer.from(raw)));
      listeners.end.forEach((fn) => fn());
    },
  };
  const res = {
    headersSent: false,
    statusCode: 0,
    body: "",
    writeHead(code) {
      this.statusCode = code;
      this.headersSent = true;
    },
    end(text) {
      this.body = text || "";
    },
  };
  const p = handleEsportRequest(req, res, `/esport/${action}`);
  req._start();
  return p.then(() => JSON.parse(res.body || "{}"));
}

async function fetchApiPlatforms() {
  store.ensureSeed();
  const login = await mockEsportCall("Client_Login", {
    userName: "admin",
    password: "admin",
  });
  if (login.success !== 1 || !login.info?.token) {
    throw new Error(`Client_Login 失败: ${login.msg || "unknown"}`);
  }
  const token = login.info.token;
  const out = {};
  for (const provider of ALL_PLATFORMS) {
    const r = await mockEsportCall("Client_GetCollectPlatform", { provider }, token);
    out[provider] = r.info || {};
  }
  return out;
}

function summarizeAccounts(accounts) {
  const byProvider = {};
  for (const acc of accounts) {
    const p = acc.provider;
    if (!p) continue;
    if (!byProvider[p]) {
      byProvider[p] = { count: 0, withGateway: 0, withToken: 0, withBalance: 0 };
    }
    byProvider[p].count += 1;
    if (acc.gateway) byProvider[p].withGateway += 1;
    if (acc.token) byProvider[p].withToken += 1;
    if (acc.balance != null) byProvider[p].withBalance += 1;
  }
  return byProvider;
}

async function probePlatform(provider) {
  switch (provider) {
    case "OB": {
      const row = store.getPlatform("OB");
      if (!row?.gateway || !row?.token) {
        return { skipped: true, reason: "缺少 OB 会话" };
      }
      const { obGet } = requirePlatform("OB", "node", "session.js");
      const r = await obGet(row.gateway, "/game/index?game_id=0&flag=1&day=1", row.token);
      const count = Array.isArray(r.json?.data) ? r.json.data.length : 0;
      return { ok: r.json?.status !== "false", detail: `matches=${count}` };
    }
    case "RAY": {
      const { login, fetchMatchPage } = requirePlatform("RAY", "node", "session.js");
      const session = await login();
      const rows = await fetchMatchPage(session, 1);
      return { ok: Array.isArray(rows), detail: `page1=${rows.length}` };
    }
    case "PB": {
      const { tryLoadSession, fetchEuroOdds } = requirePlatform("PB", "node", "session.js");
      const session = tryLoadSession();
      if (!session) return { skipped: true, reason: "缺少 PB 会话" };
      const payload = await fetchEuroOdds(session);
      const { parseEuroOddsPayload } = await import("@changmen/platform-probes/pb/core.js");
      const parsed = parseEuroOddsPayload(payload);
      return { ok: parsed.matches.length >= 0, detail: `matches=${parsed.matches.length}` };
    }
    case "TF": {
      const { tryLoadSession, tfGet } = requirePlatform("TF", "node", "session.js");
      const session = tryLoadSession();
      if (!session) return { skipped: true, reason: "缺少 TF 会话" };
      const data = await tfGet(session, "/api/v8/events/", { page: "1", limit: "5" });
      const count = Array.isArray(data?.results) ? data.results.length : 0;
      return { ok: true, detail: `events=${count}` };
    }
    case "IA": {
      const { tryLoadSession, fetchGameList } = await import("@changmen/platform-probes/ia/session.js");
      const session = tryLoadSession();
      if (!session) return { skipped: true, reason: "缺少 IA 会话" };
      const list = await fetchGameList(session);
      const count = Array.isArray(list) ? list.length : 0;
      return { ok: true, detail: `matches=${count}` };
    }
    case "IMT": {
      const { tryLoadSession, fetchAllLiveEvents } = await import("@changmen/platform-probes/imt/session.js");
      const session = tryLoadSession();
      if (!session) return { skipped: true, reason: "缺少 IMT 会话" };
      const data = await fetchAllLiveEvents(session, session.sportIds);
      const count = Array.isArray(data?.Events) ? data.Events.length : 0;
      return { ok: true, detail: `events=${count}` };
    }
    case "SABA": {
      const { tryLoadSession, fetchEsportsPage } = await import("@changmen/platform-probes/saba/session.js");
      const session = tryLoadSession();
      if (!session) return { skipped: true, reason: "缺少 SABA 会话" };
      const html = await fetchEsportsPage(session);
      const Core = await import("@changmen/platform-probes/saba/core.js");
      const parsed = Core.parseEsportsPage(html, session.gateway);
      return { ok: Boolean(parsed), detail: parsed ? "page parsed" : "parse failed" };
    }
    case "Stake": {
      const { tryLoadSession, fetchAllSports } = await import("@changmen/platform-probes/stake/session.js");
      const session = tryLoadSession();
      if (!session) return { skipped: true, reason: "缺少 Stake 会话" };
      const rows = await fetchAllSports(session);
      return { ok: Array.isArray(rows), detail: `sports=${rows.length}` };
    }
    case "IM":
    case "XBet":
      return { skipped: true, reason: "A8 Socket + 插件，无 HTTP 探针" };
    case "HG":
      return { skipped: true, reason: "占位平台" };
    default:
      return { skipped: true, reason: "unknown" };
  }
}

async function runAudit(opts) {
  store.ensureSeed();
  const platformsJson = loadPlatformsJson();
  const accounts = loadAccounts();
  const accountSummary = summarizeAccounts(accounts);
  let apiPlatforms = null;
  try {
    apiPlatforms = await fetchApiPlatforms();
  } catch (err) {
    apiPlatforms = { _error: err.message };
  }

  const rows = [];
  let missingRequired = 0;

  for (const provider of ALL_PLATFORMS) {
    const spec = SPEC[provider];
    const eff = effectiveCollectPlatform(provider);
    const status = configStatus(provider, eff);
    if (status === "MISSING") missingRequired += 1;

    const api = apiPlatforms?.[provider] || {};
    const apiMatch =
      apiPlatforms && !apiPlatforms._error
        ? eff.gateway === (api.Gateway || "") &&
          String(eff.token).length === String(api.Token || "").length
        : null;

    const entry = {
      provider,
      status,
      note: spec.note,
      needs: { gateway: spec.needsGateway, token: spec.needsToken },
      effective: {
        source: eff.source,
        gateway: eff.gateway,
        gatewayMask: mask(eff.gateway),
        tokenLen: String(eff.token || "").length,
        tokenMask: mask(eff.token),
        inPlatformsJson: eff.inPlatformsJson ?? Boolean(platformsJson[provider]),
        games: eff.games,
      },
      api: apiPlatforms?._error
        ? { error: apiPlatforms._error }
        : {
            gateway: api.Gateway || "",
            gatewayMask: mask(api.Gateway),
            tokenLen: String(api.Token || "").length,
            matchesEffective: apiMatch,
          },
      accounts: accountSummary[provider] || null,
    };

    if (opts.probe) {
      try {
        entry.probe = await probePlatform(provider);
      } catch (err) {
        entry.probe = { ok: false, error: err.message };
      }
    }

    rows.push(entry);
  }

  return {
    generatedAt: new Date().toISOString(),
    platformsJsonPath: PLATFORMS_FILE,
    platformsJsonKeys: Object.keys(platformsJson),
    missingRequired,
    rows,
  };
}

function printHuman(report) {
  console.log("=== 采集平台配置审计 ===");
  console.log(`文件: ${report.platformsJsonPath}`);
  console.log(`platforms.json 条目: ${report.platformsJsonKeys.join(", ") || "(空)"}`);
  console.log("");

  for (const row of report.rows) {
    console.log(
      `${row.provider.padEnd(6)} ${row.status.padEnd(8)} gw=${row.effective.gatewayMask || "(空)"} token=${row.effective.tokenMask || "(空)"}`,
    );
    console.log(
      `       来源: ${row.effective.source}${row.effective.games != null ? ` · games=${row.effective.games}` : ""}`,
    );
    if (row.accounts) {
      console.log(
        `       账号: ${row.accounts.count} 条 (gw=${row.accounts.withGateway} tok=${row.accounts.withToken} bal=${row.accounts.withBalance})`,
      );
    }
    if (row.api && !row.api.error) {
      const sync = row.api.matchesEffective ? "一致" : "不一致";
      console.log(
        `       API: gw=${row.api.gatewayMask || "(空)"} tokenLen=${row.api.tokenLen} (${sync})`,
      );
    } else if (row.api?.error) {
      console.log(`       API: 跳过 (${row.api.error})`);
    }
    if (row.probe) {
      if (row.probe.skipped) {
        console.log(`       探针: 跳过 — ${row.probe.reason}`);
      } else if (row.probe.ok) {
        console.log(`       探针: OK — ${row.probe.detail || ""}`);
      } else {
        console.log(`       探针: FAIL — ${row.probe.error || row.probe.detail || ""}`);
      }
    }
    console.log(`       ${row.note}`);
    console.log("");
  }

  if (report.missingRequired > 0) {
    console.log(`⚠ ${report.missingRequired} 个平台缺少采集凭证（不含 HG/IM/XBet 可选 token）`);
    console.log("  补全: npm run account:import-platform -- <base64> --sync-store");
    console.log("  或设置 TF_GATEWAY/TF_TOKEN、IA_*、IMT_*、SABA_*、STAKE_ACCESS_TOKEN 等环境变量");
  } else {
    console.log("✓ 所有必需凭证已配置");
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log("用法: npm run check:collect [--probe] [--json]");
    process.exit(0);
  }

  const report = await runAudit(opts);
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHuman(report);
  }

  process.exit(report.missingRequired > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
