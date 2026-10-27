import fs from "node:fs";
import path from "node:path";
import { ESPORT_DATA_DIR } from "@changmen/storage/paths";
import { getActivePlatformGameIds } from "@changmen/storage/game_catalog";

export const DEFAULT_GATEWAY = "https://pc.ilustre-analytics.org";

const PLATFORMS_FILE = path.join(ESPORT_DATA_DIR, "platforms.json");

function normalizeGateway(gateway) {
  return String(gateway || "").replace(/\/+$/, "");
}

function loadFromPlatformsJson() {
  try {
    if (!fs.existsSync(PLATFORMS_FILE)) return null;
    const all = JSON.parse(fs.readFileSync(PLATFORMS_FILE, "utf8"));
    const row = all.IA;
    if (!row?.gateway) return null;
    return buildSessionFromRow(row);
  } catch {
    return null;
  }
}

function loadFromEnv() {
  const gateway = process.env.IA_GATEWAY;
  if (!gateway) return null;
  return buildSessionFromRow({
    gateway,
    token: process.env.IA_TOKEN || "",
    betName: process.env.IA_BET_NAME,
    games: parseGameIdsEnv(),
  });
}

function buildSessionFromRow(row) {
  return {
    provider: "IA",
    gateway: normalizeGateway(row.gateway || DEFAULT_GATEWAY),
    token: row.token,
    betName:
      row.betName ||
      process.env.IA_BET_NAME ||
      "([ȫ��].+��ʤ$)|([��ͼ\\d].+��ʤ��$)",
    gameIds: Array.isArray(row.games) ? row.games.map(String) : parseGameIdsEnv(),
    fetchedAt: null,
  };
}

export function parseGameIdsEnv() {
  const raw = process.env.IA_GAME_IDS;
  if (raw === "*") return [];
  if (raw) {
    return raw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  }
  return getActivePlatformGameIds("IA");
}

export function tryLoadSession() {
  return loadFromEnv() || loadFromPlatformsJson();
}

export function loadSession() {
  const session = tryLoadSession();
  if (!session) {
    throw new Error("ȱ�� IA ƾ֤��IA_GATEWAY + IA_TOKEN �� platforms.json��");
  }
  return session;
}

export async function iaGet(session, urlPath) {
  const base = session.gateway.replace(/\/$/, "");
  const url = `${base}${urlPath.startsWith("/") ? urlPath : `/${urlPath}`}`;
  const res = await fetch(url, {
    headers: { token: session.token },
  });
  if (!res.ok) {
    throw new Error(`IA GET ${urlPath} HTTP ${res.status}`);
  }
  const body = await res.json();
  if (body?.code !== undefined && body.code !== 1) {
    throw new Error(body.msg || `IA GET ${urlPath} code=${body.code}`);
  }
  return body;
}

export async function iaPost(session, urlPath, payload) {
  const base = session.gateway.replace(/\/$/, "");
  const url = `${base}${urlPath.startsWith("/") ? urlPath : `/${urlPath}`}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      token: session.token,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`IA POST ${urlPath} HTTP ${res.status}`);
  }
  const body = await res.json();
  if (body?.code !== undefined && body.code !== 1) {
    throw new Error(body.msg || `IA POST ${urlPath} code=${body.code}`);
  }
  return body;
}

export async function fetchGameList(session) {
  const body = await iaGet(session, "/api/game/game/gameListPageSplit/");
  const rows = body?.data?.data;
  return Array.isArray(rows) ? rows : [];
}

export async function fetchPointsList(session, gameId) {
  const body = await iaPost(session, "/api/game/game/getPointsListSplit", {
    game_id: gameId,
    lang: 1,
  });
  return body?.data?.plays || [];
}

export function persistPlatform(session) {
  try {
    const dir = path.dirname(PLATFORMS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let all = {};
    if (fs.existsSync(PLATFORMS_FILE)) {
      all = JSON.parse(fs.readFileSync(PLATFORMS_FILE, "utf8"));
    }
    all.IA = {
      gateway: session.gateway,
      token: session.token,
      betName: session.betName,
      games: session.gameIds,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(PLATFORMS_FILE, `${JSON.stringify(all, null, 2)}\n`);
  } catch (err) {
    console.warn("[ia-session] persist skip:", err.message);
  }
}
