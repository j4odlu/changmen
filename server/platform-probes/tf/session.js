import fs from "node:fs";
import path from "node:path";
import { ESPORT_DATA_DIR } from "@changmen/storage/paths";
import {
  ensureDefaultJsonFiles,
  setPlatform,
} from "@changmen/storage/platform_storage";
import { getActivePlatformGameIds } from "@changmen/storage/game_catalog";
import { tfRequestHeaders } from "./auth.js";

export const DEFAULT_GATEWAY = "https://api-v4.tf-api-rr3h.com";

const PLATFORMS_FILE = path.join(ESPORT_DATA_DIR, "platforms.json");

function normalizeGateway(gateway) {
  return String(gateway || "").replace(/\/+$/, "");
}

function loadFromPlatformsJson() {
  try {
    if (!fs.existsSync(PLATFORMS_FILE)) return null;
    const all = JSON.parse(fs.readFileSync(PLATFORMS_FILE, "utf8"));
    const row = all.TF;
    if (!row?.gateway || !row?.token) return null;
    return buildSessionFromRow(row);
  } catch {
    return null;
  }
}

function loadFromEnv() {
  const gateway = process.env.TF_GATEWAY;
  const token = process.env.TF_TOKEN;
  if (!gateway || !token) return null;
  return buildSessionFromRow({
    gateway,
    token,
    betName: process.env.TF_BET_NAME,
    games: parseGameIdsEnv(),
  });
}

function buildSessionFromRow(row) {
  return {
    provider: "TF",
    gateway: normalizeGateway(row.gateway),
    token: row.token,
    betName: row.betName || process.env.TF_BET_NAME || "^��ʤ��$",
    gameIds: Array.isArray(row.games) ? row.games.map(String) : parseGameIdsEnv(),
    fetchedAt: null,
  };
}

export function parseGameIdsEnv() {
  const raw = process.env.TF_GAME_IDS;
  if (raw === "*") return [];
  if (raw) {
    return raw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  }
  return getActivePlatformGameIds("TF");
}

export function tryLoadSession() {
  return loadFromEnv() || loadFromPlatformsJson();
}

export function loadSession() {
  const session = tryLoadSession();
  if (!session) {
    throw new Error("ȱ�� TF ƾ֤��TF_GATEWAY + TF_TOKEN �� platforms.json��");
  }
  return session;
}

export async function tfGet(session, urlPath, query = {}) {
  const base = session.gateway.replace(/\/$/, "");
  const qs = new URLSearchParams({
    combo: "false",
    outright: "false",
    lang: "zh",
    timezone: "Asia/Shanghai",
    ...query,
  });
  const url = `${base}${urlPath.startsWith("/") ? urlPath : `/${urlPath}`}?${qs}`;
  const res = await fetch(url, {
    headers: tfRequestHeaders(session.token),
    signal: AbortSignal.timeout(25000),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(`TF HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return { url, status: res.status, json };
}

export async function fetchTodayEvents(session) {
  const rows = [];
  let page = 1;
  while (page <= 5) {
    const r = await tfGet(session, "/api/v8/events/", {
      game_id: "",
      timing: "today",
      market_option: "MATCH",
      page_size: "50",
      page: String(page),
    });
    const batch = r.json.results || [];
    rows.push(...batch);
    if (!r.json.next || !batch.length) break;
    page += 1;
  }
  return rows;
}

export async function fetchEventMarkets(session, eventId, options = {}) {
  const marketOption = options.marketOption || "MATCH";
  const mapOption = options.mapOption ?? "";
  const query = {
    event_id: String(eventId),
    market_option: marketOption,
  };
  if (marketOption === "MAP" && mapOption) {
    query.map_option = mapOption;
  }
  const r = await tfGet(session, "/api/v8/events/", query);
  return r.json.results || [];
}

export function persistPlatform(session) {
  ensureDefaultJsonFiles();
  setPlatform("TF", {
    gateway: session.gateway,
    token: session.token,
    betName: session.betName,
    games: session.gameIds.map(String),
  });
}
