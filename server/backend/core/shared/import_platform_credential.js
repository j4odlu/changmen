import path from "node:path";
import { getActivePlatformGameIds } from "@changmen/storage/game_catalog.js";
import { readJsonFile, writeJsonFile } from "@changmen/storage/json_file_store.js";
import { ESPORT_DATA_DIR } from "@changmen/storage/paths.js";
import { ensureDefaultJsonFiles } from "@changmen/storage/platform_storage.js";
import { parseClipboardCredential } from "../account/clipboard_credential.js";

const PLATFORMS_FILE = path.join(ESPORT_DATA_DIR, "platforms.json");

const PROVIDER_DEFAULTS = {
  OB: { betName: ".*" },
  RAY: { betName: "^获胜者$" },
  PB: { betName: ".*" },
  TF: { betName: "^获胜者$" },
  IA: { betName: "([全场].+获胜$)|([地图\\d].+获胜者$)" },
  IM: { betName: ".*" },
  XBet: { betName: ".*" },
};

export function readPlatformsFile() {
  return readJsonFile("platforms", {}) || {};
}

export function writePlatformsFile(data) {
  ensureDefaultJsonFiles();
  writeJsonFile("platforms", data);
}

function buildPlatformEntry(cred, prev = {}) {
  const provider = cred.provider;
  const defaults = PROVIDER_DEFAULTS[provider] || { betName: ".*" };
  const entry = {
    ...prev,
    gateway: cred.gateway,
    token: cred.token,
    referer: cred.referer || cred.gateway,
    provider,
    updatedAt: Date.now(),
  };

  if (cred.userAgent)
    entry.userAgent = cred.userAgent;
  if (defaults.betName !== undefined) {
    entry.betName = prev.betName ?? defaults.betName;
  }

  try {
    const gameIds = getActivePlatformGameIds(provider);
    if (gameIds.length) {
      entry.games = prev.games?.length ? prev.games : gameIds.map(String);
    }
  }
  catch {
    if (prev.games?.length)
      entry.games = prev.games;
  }

  if (provider === "PB" && entry.cookie === undefined) {
    entry.cookie = prev.cookie || "";
  }

  return entry;
}

/** 将 A8 插件弹窗中的 data（Base64 JSON）写入 storage/platforms.json */
export function importPlatformCredential(base64Text) {
  const cred = parseClipboardCredential(base64Text);
  const key = cred.provider;
  const all = readPlatformsFile();
  const prev = all[key] || {};
  all[key] = buildPlatformEntry(cred, prev);
  writePlatformsFile(all);
  return { provider: key, entry: all[key], file: PLATFORMS_FILE };
}

export { PLATFORMS_FILE };
