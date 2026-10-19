"use strict";

const fs = require("fs");
const path = require("path");
const { ESPORT_DATA_DIR } = require("../backend/_paths.cjs");
const { getActivePlatformGameIds } = require("./_require.js").backendRequire("@changmen/storage/game_catalog.js");
const Core = require("./core.js");

const PLATFORMS_FILE = path.join(ESPORT_DATA_DIR, "platforms.json");
const DEFAULT_SPORT_PATH = "43";

function normalizeGateway(gateway) {
  return String(gateway || "").replace(/\/+$/, "");
}

function parseGameIdsEnv() {
  const raw = process.env.SABA_GAME_IDS;
  if (raw === "*") return [];
  if (raw) return raw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  return getActivePlatformGameIds("SABA");
}

function loadFromPlatformsJson() {
  try {
    if (!fs.existsSync(PLATFORMS_FILE)) return null;
    const all = JSON.parse(fs.readFileSync(PLATFORMS_FILE, "utf8"));
    const row = all.SABA;
    if (!row?.gateway || !row?.token) return null;
    return buildSessionFromRow(row);
  } catch {
    return null;
  }
}

function loadFromEnv() {
  const gateway = process.env.SABA_GATEWAY;
  const token = process.env.SABA_TOKEN;
  if (!gateway || !token) return null;
  return buildSessionFromRow({
    gateway,
    token,
    sportPath: process.env.SABA_SPORT_PATH,
    gameIds: parseGameIdsEnv(),
  });
}

function buildSessionFromRow(row) {
  const gateway = normalizeGateway(row.gateway);
  const sportPath = row.sportPath || process.env.SABA_SPORT_PATH || DEFAULT_SPORT_PATH;
  const pageUrl = `${gateway}/${row.token}/ESports/${sportPath}/ALL?mode=m0&market=L`;
  return {
    provider: "SABA",
    gateway,
    token: row.token,
    sportPath,
    pageUrl,
    gameIds: Array.isArray(row.games) ? row.games.map(String) : parseGameIdsEnv(),
  };
}

function tryLoadSession() {
  return loadFromEnv() || loadFromPlatformsJson();
}

async function fetchEsportsPage(session) {
  const res = await fetch(session.pageUrl, {
    headers: {
      "user-agent":
        process.env.SABA_USER_AGENT ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    },
  });
  if (!res.ok) {
    throw new Error(`SABA page HTTP ${res.status}`);
  }
  return res.text();
}

async function resolveWsConfig(session) {
  const html = await fetchEsportsPage(session);
  const wsConfig = Core.parseEsportsPage(html);
  if (!wsConfig?.token) {
    throw new Error("SABA 页面解析失败（缺少 url/id/account）");
  }
  const originHost = new URL(session.gateway).host;
  return {
    ...wsConfig,
    origin: `https://${originHost}`,
    checkinUrl: `${session.gateway}/${session.token}/LoginCheckin/Index`,
    session,
  };
}

async function loginCheckin(config) {
  await fetch(config.checkinUrl, {
    method: "POST",
    headers: { username: "" },
  });
}

function persistPlatform(session, wsConfig) {
  try {
    const dir = path.dirname(PLATFORMS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let all = {};
    if (fs.existsSync(PLATFORMS_FILE)) {
      all = JSON.parse(fs.readFileSync(PLATFORMS_FILE, "utf8"));
    }
    all.SABA = {
      gateway: session.gateway,
      token: session.token,
      games: session.gameIds,
      wsHost: wsConfig.wsHost,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(PLATFORMS_FILE, JSON.stringify(all, null, 2));
  } catch {
    /* ignore */
  }
}

module.exports = {
  tryLoadSession,
  resolveWsConfig,
  loginCheckin,
  persistPlatform,
};
