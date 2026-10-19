"use strict";

const fs = require("fs");
const path = require("path");
const { ESPORT_DATA_DIR } = require("../backend/_paths.cjs");
const { getDefaultSportIds } = require("./sport_ids.js");
const { getActivePlatformGameIds } = require("./_require.js").backendRequire("@changmen/storage/game_catalog.js");

const PLATFORMS_FILE = path.join(ESPORT_DATA_DIR, "platforms.json");

function normalizeGateway(gateway) {
  return String(gateway || "").replace(/\/+$/, "");
}

function decodeToken(raw) {
  if (!raw) return null;
  try {
    const json = Buffer.from(String(raw), "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function loadFromPlatformsJson() {
  try {
    if (!fs.existsSync(PLATFORMS_FILE)) return null;
    const all = JSON.parse(fs.readFileSync(PLATFORMS_FILE, "utf8"));
    const row = all.IMT;
    if (!row?.gateway || !row?.token) return null;
    return buildSessionFromRow(row);
  } catch {
    return null;
  }
}

function loadFromEnv() {
  const gateway = process.env.IMT_GATEWAY;
  const token = process.env.IMT_TOKEN;
  if (!gateway || !token) return null;
  return buildSessionFromRow({
    gateway,
    token,
    referer: process.env.IMT_REFERER,
    userAgent: process.env.IMT_USER_AGENT,
    xSc: process.env.IMT_X_SC,
    sportIds: parseSportIdsEnv(),
  });
}

function buildSessionFromRow(row) {
  const decoded = decodeToken(row.token);
  return {
    provider: "IMT",
    gateway: normalizeGateway(row.gateway),
    token: row.token,
    tokenPayload: decoded,
    referer: row.referer || process.env.IMT_REFERER || row.gateway,
    userAgent:
      row.userAgent ||
      process.env.IMT_USER_AGENT ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    xSc:
      row.xSc ||
      process.env.IMT_X_SC ||
      "AlcIWQJYUwMIBwEFVAkLVAECBw9QVV0BDQpXWAAHAVIABB0DACFIbmFVIlI9BCw6OBBxXANsEzZZ",
    sportIds: Array.isArray(row.sportIds) ? row.sportIds.map(String) : parseSportIdsEnv(),
    fetchedAt: null,
  };
}

function parseSportIdsEnv() {
  const raw = process.env.IMT_SPORT_IDS;
  if (raw === "*") return [];
  if (raw) {
    return raw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  }
  const fromCatalog = [...new Set(getActivePlatformGameIds("IMT"))];
  return fromCatalog.length ? fromCatalog : getDefaultSportIds();
}

function tryLoadSession() {
  return loadFromEnv() || loadFromPlatformsJson();
}

function loadSession() {
  const session = tryLoadSession();
  if (!session) {
    throw new Error("缺少 IMT 凭证（IMT_GATEWAY + IMT_TOKEN 或 platforms.json）");
  }
  return session;
}

function buildHeaders(session) {
  const decoded = session.tokenPayload || decodeToken(session.token);
  return {
    "content-type": "application/json; charset=utf-8",
    referer: session.referer,
    "user-agent": session.userAgent,
    "x-isfacelift": "true",
    "x-lang": "hans",
    "x-platform": "1",
    "x-sc": session.xSc,
    "x-token": decoded?.tk || "",
    "x-v": decoded?.v || "",
    "x-viewtype": "1",
  };
}

async function imtPost(session, urlPath, body) {
  const base = session.gateway.replace(/\/$/, "");
  const url = `${base}${urlPath.startsWith("/") ? urlPath : `/${urlPath}`}`;
  const res = await fetch(url, {
    method: "POST",
    headers: buildHeaders(session),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`IMT POST ${urlPath} HTTP ${res.status}`);
  }
  const data = await res.json();
  if (data?.StatusCode !== 100) {
    throw new Error(data?.Message || `IMT POST ${urlPath} StatusCode=${data?.StatusCode}`);
  }
  return data;
}

async function fetchAllLiveEvents(session, sportIds) {
  const ids = sportIds?.length ? sportIds : getDefaultSportIds();
  const body = {
    AllLiveEventsRequestGroups: ids.map((id) => ({
      SportId: Number(id),
      EventGroupTypeIds: [],
      OddsTemplateBetType: 0,
      OddsTemplate: 16,
    })),
    IsCombo: false,
    OddsType: 3,
    BetTypes: [283],
    Periods: [1],
    SortingType: 2,
    PanelType: 2,
  };
  return imtPost(session, "/mobilesitev2/api/Event/GetAllLiveEvents", body);
}

async function fetchLiveEventsDelta(session, sportIds, delta) {
  const ids = sportIds?.length ? sportIds : getDefaultSportIds();
  const body = {
    AllLiveEventsDeltaRequestGroups: ids.map((id) => ({
      SportId: Number(id),
      EventGroupTypeIds: [],
      OddsTemplateBetType: 0,
      OddsTemplate: 16,
    })),
    CompetitionIds: [],
    SortingType: 2,
    Delta: delta,
    BetTypes: [283],
    Periods: [1],
    OddsType: 3,
    SportIds: ids.map(Number),
    IsCombo: false,
    PanelType: 2,
  };
  return imtPost(session, "/mobilesitev2/api/Event/getAllLiveEventsDelta", body);
}

function persistPlatform(session) {
  try {
    const dir = path.dirname(PLATFORMS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let all = {};
    if (fs.existsSync(PLATFORMS_FILE)) {
      all = JSON.parse(fs.readFileSync(PLATFORMS_FILE, "utf8"));
    }
    all.IMT = {
      gateway: session.gateway,
      token: session.token,
      referer: session.referer,
      userAgent: session.userAgent,
      xSc: session.xSc,
      sportIds: session.sportIds,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(PLATFORMS_FILE, `${JSON.stringify(all, null, 2)}\n`);
  } catch (err) {
    console.warn("[imt-session] persist skip:", err.message);
  }
}

module.exports = {
  tryLoadSession,
  loadSession,
  fetchAllLiveEvents,
  fetchLiveEventsDelta,
  persistPlatform,
  decodeToken,
};
