"use strict";

const fs = require("fs");
const path = require("path");
const { ESPORT_DATA_DIR } = require("../backend/_paths.cjs");
const Core = require("./core.js");

const PLATFORMS_FILE = path.join(ESPORT_DATA_DIR, "platforms.json");
const DEFAULT_API = "https://stake.com";

function normalizeApiUrl(url) {
  return String(url || DEFAULT_API).replace(/\/+$/, "");
}

function defaultSportSlugs() {
  const raw = process.env.STAKE_SPORTS;
  if (raw) {
    return raw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  }
  return Object.keys(Core.SPORT_SLUG_TO_CODE);
}

function loadFromPlatformsJson() {
  try {
    if (!fs.existsSync(PLATFORMS_FILE)) return null;
    const all = JSON.parse(fs.readFileSync(PLATFORMS_FILE, "utf8"));
    const row = all.Stake || all.STAKE;
    if (!row?.accessToken && !row?.token) return null;
    return buildSessionFromRow(row);
  } catch {
    return null;
  }
}

function loadFromEnv() {
  const accessToken = process.env.STAKE_ACCESS_TOKEN || process.env.STAKE_TOKEN;
  if (!accessToken) return null;
  return buildSessionFromRow({
    apiUrl: process.env.STAKE_API_URL,
    accessToken,
    sports: defaultSportSlugs(),
  });
}

function buildSessionFromRow(row) {
  return {
    provider: "Stake",
    apiUrl: normalizeApiUrl(row.apiUrl || row.gateway || DEFAULT_API),
    accessToken: row.accessToken || row.token,
    sports: Array.isArray(row.sports) ? row.sports : defaultSportSlugs(),
  };
}

function tryLoadSession() {
  return loadFromEnv() || loadFromPlatformsJson();
}

function stakeHeaders(session) {
  return {
    "content-type": "application/json",
    "x-language": "zh",
    "x-access-token": session.accessToken,
    "x-operation-name": "SportIndex",
    "x-operation-type": "query",
  };
}

async function fetchSportIndex(session, sportSlug) {
  const url = `${session.apiUrl}/_api/graphql`;
  const res = await fetch(url, {
    method: "POST",
    headers: stakeHeaders(session),
    body: JSON.stringify({
      query: Core.STAKE_GRAPHQL,
      variables: { sport: sportSlug, groups: ["winner", "maps"] },
    }),
  });
  if (!res.ok) {
    throw new Error(`Stake GraphQL ${sportSlug} HTTP ${res.status}`);
  }
  return res.json();
}

async function fetchAllSports(session) {
  const all = [];
  for (const slug of session.sports) {
    try {
      const data = await fetchSportIndex(session, slug);
      all.push(...Core.normalizeGraphqlSport(slug, data));
    } catch (err) {
      console.warn(`[stake] ${slug}:`, err.message);
    }
  }
  return all;
}

function persistPlatform(session) {
  try {
    const dir = path.dirname(PLATFORMS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let all = {};
    if (fs.existsSync(PLATFORMS_FILE)) {
      all = JSON.parse(fs.readFileSync(PLATFORMS_FILE, "utf8"));
    }
    all.Stake = {
      gateway: session.apiUrl,
      accessToken: session.accessToken,
      sports: session.sports,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(PLATFORMS_FILE, JSON.stringify(all, null, 2));
  } catch {
    /* ignore */
  }
}

module.exports = {
  tryLoadSession,
  fetchAllSports,
  persistPlatform,
};
