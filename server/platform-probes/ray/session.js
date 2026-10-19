import * as Core from "./core.js";
import { getActivePlatformGameIds } from "@changmen/storage/game_catalog.js";

const DEFAULT_SITE_ORIGIN = "https://ray164.com";

export function rayHeaders(token, origin) {
  const headers = {
    Accept: "application/json, text/plain, */*",
    Origin: origin || DEFAULT_SITE_ORIGIN,
    Referer: `${origin || DEFAULT_SITE_ORIGIN}/`,
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  };
  if (token) {
    headers.Authorization = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
  }
  return headers;
}

export async function rayGet(gateway, path, token, origin) {
  const base = gateway.replace(/\/$/, "");
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    headers: rayHeaders(token, origin),
    signal: AbortSignal.timeout(25000),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 200)}`);
  }
  return { url, status: res.status, json };
}

export async function pickGateway(gateways, token, origin) {
  for (const gw of gateways) {
    try {
      const r = await rayGet(gw, "/match?match_type=2&page=1", token, origin);
      if (r.json.code === 200 && Array.isArray(r.json.result)) return gw;
    } catch {
      /* try next */
    }
  }
  throw new Error("No reachable RAY API gateway");
}

export async function fetchMatchPage(session, page = 1) {
  const r = await rayGet(
    session.gateway,
    `/match?match_type=2&page=${page}`,
    session.token,
    session.origin,
  );
  if (r.json.code !== 200) {
    throw new Error(r.json.desc || r.json.message || `match list failed (${r.json.code})`);
  }
  return r.json.result || [];
}

export function oddsPayloadFromMatchRaw(raw) {
  if (!raw || !Array.isArray(raw.odds) || raw.odds.length === 0) return null;
  return raw;
}

export async function fetchOdds(session, matchId, options = {}) {
  const retries = options.retries ?? 1;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * attempt));
    try {
      const r = await rayGet(
        session.gateway,
        `/odds?match_id=${encodeURIComponent(matchId)}`,
        session.token,
        session.origin,
      );
      if (r.status === 429 || r.json?.error_code === 1015) {
        throw new Error("RAY odds rate limited (429)");
      }
      if (r.json.code !== 200) {
        throw new Error(r.json.desc || r.json.message || `odds failed (${r.json.code})`);
      }
      return r.json.result;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

export function buildSession(options = {}) {
  const token = options.token || process.env.RAY_TOKEN || "";
  const gateways = options.gateways || Core.DEFAULT_GATEWAYS;
  const gameIds = options.gameIds || parseGameIdsEnv();
  return {
    provider: "RAY",
    siteOrigin: options.origin || process.env.RAY_ORIGIN || DEFAULT_SITE_ORIGIN,
    origin: options.origin || process.env.RAY_ORIGIN || DEFAULT_SITE_ORIGIN,
    token,
    gateways,
    gameIds,
    gateway: null,
    fetchedAt: null,
  };
}

function parseGameIdsEnv() {
  const raw = process.env.RAY_GAME_IDS;
  if (raw === "*") return [];
  if (raw) {
    return raw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  }
  return getActivePlatformGameIds("RAY");
}

export async function login(options = {}) {
  const session = buildSession(options);
  session.gateway = await pickGateway(session.gateways, session.token, session.origin);
  session.fetchedAt = new Date().toISOString();
  return session;
}

export { DEFAULT_SITE_ORIGIN };
