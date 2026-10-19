import { getActivePlatformGameIds } from "@changmen/storage/game_catalog.js";
import { requirePlatform } from "../shared/adapter_paths.js";
import store from "./store.js";

const { getRayA8CollectCredentials } = requirePlatform("RAY", "node", "collect_credentials.js");
const { login, obGet } = requirePlatform("OB", "node", "session.js");

function syncObFromSession(session) {
  if (!session?.gateway || !session?.token)
    return false;
  store.setPlatform("OB", {
    gateway: session.gateway,
    token: session.token,
    betName: store.getPlatform("OB")?.betName || ".*",
    games: getActivePlatformGameIds("OB").map(String),
  });
  return true;
}

/** ?? data/esport/platforms.json ??????gateway/token???????? feed ???? */
function syncObFromStore() {
  const row = store.getPlatform("OB");
  if (!row?.gateway || !row?.token)
    return false;
  return syncObFromSession({
    gateway: row.gateway,
    token: row.token,
    lang: "cn",
    gateways: [row.gateway],
  });
}

async function probeObSession(gateway, token) {
  const r = await obGet(
    gateway,
    "/game/index?game_id=0&flag=1&day=1",
    token,
    "cn",
  );
  return r.json.status === "true" || Array.isArray(r.json.data);
}

/**
 * Feed / ?????? platforms.json ????????login ?????? index??
 */
async function resolveObSession() {
  const row = store.getPlatform("OB");
  if (row?.gateway && row?.token) {
    try {
      if (await probeObSession(row.gateway, row.token)) {
        const session = {
          gateway: row.gateway,
          token: row.token,
          lang: "cn",
          gateways: [row.gateway],
        };
        syncObFromSession(session);
        return session;
      }
    }
    catch (err) {
      console.warn("[OB] stored session invalid:", err.message);
    }
  }
  const session = await login();
  syncObFromSession(session);
  return session;
}

async function syncObLogin() {
  const session = await resolveObSession();
  return session;
}

function syncRayFromA8() {
  const a8 = getRayA8CollectCredentials();
  store.setPlatform("RAY", {
    gateway: a8.gateway,
    token: a8.token,
    betName: a8.betName,
    games: a8.games.map(String),
  });
  return true;
}

function syncRayFromEnv() {
  if (process.env.RAY_COLLECT_USE_ENV !== "1")
    return false;
  const raw = process.env.RAY_TOKEN || process.env.RAY_WS_TOKEN || "";
  if (!raw)
    return false;
  const token = raw.startsWith("Bearer ") ? raw : `Bearer ${raw}`;
  store.setPlatform("RAY", {
    gateway: process.env.RAY_GATEWAY || "https://cfinfo.365raylinks.com",
    token,
    betName: "^????",
    games: getActivePlatformGameIds("RAY").map(String),
  });
  return true;
}

function syncRayFromSession(_session) {
  // RAY ???? A8 ?????feed ?? session ????platforms.json
  return syncRayFromA8();
}

function syncPbFromEnv() {
  const gateway = process.env.PB_GATEWAY;
  const token = process.env.PB_TOKEN;
  if (!gateway || !token)
    return false;
  store.setPlatform("PB", {
    gateway,
    token,
    betName: ".*",
    games: getActivePlatformGameIds("PB").map(String),
    cookie: process.env.PB_COOKIE || "",
    referer: process.env.PB_REFERER || gateway,
    userAgent: process.env.PB_USER_AGENT || "",
  });
  return true;
}

function syncPbFromSession(session) {
  if (!session?.gateway || !session?.token)
    return false;
  store.setPlatform("PB", {
    gateway: session.gateway,
    token: typeof session.token === "string" ? session.token : JSON.stringify(session.token),
    betName: store.getPlatform("PB")?.betName || ".*",
    games: (session.gameSlugs || getActivePlatformGameIds("PB")).map(String),
    cookie: session.cookie || "",
    referer: session.referer || session.gateway,
    userAgent: session.userAgent || "",
  });
  return true;
}

async function syncTfFromLocal() {
  try {
    const { getTfA8CollectCredentials } = requirePlatform("TF", "node", "collect_credentials.js");
    const creds = await getTfA8CollectCredentials();
    store.setPlatform("TF", {
      gateway: creds.gateway,
      token: creds.token,
      betName: creds.betName || store.getPlatform("TF")?.betName || "^????",
      games: creds.games.length ? creds.games : getActivePlatformGameIds("TF").map(String),
    });
    return true;
  }
  catch (err) {
    console.warn("[platform-sync] TF local collect failed:", err.message);
    return false;
  }
}

function syncTfFromEnv() {
  const gateway = process.env.TF_GATEWAY;
  const token = process.env.TF_TOKEN;
  if (!gateway || !token)
    return false;
  store.setPlatform("TF", {
    gateway,
    token,
    betName: process.env.TF_BET_NAME || "^????",
    games: getActivePlatformGameIds("TF").map(String),
  });
  return true;
}

function syncTfFromSession(session) {
  if (!session?.gateway || !session?.token)
    return false;
  store.setPlatform("TF", {
    gateway: session.gateway,
    token: session.token,
    betName: session.betName || store.getPlatform("TF")?.betName || "^????",
    games: (session.gameIds || getActivePlatformGameIds("TF")).map(String),
  });
  return true;
}

function syncIaFromA8Defaults() {
  const { getIaA8CollectCredentials } = requirePlatform("IA", "node", "collect_credentials.js");
  const a8 = getIaA8CollectCredentials();
  store.setPlatform("IA", {
    gateway: a8.gateway,
    token: a8.token,
    betName: a8.betName,
    games: a8.games.length ? a8.games : getActivePlatformGameIds("IA").map(String),
  });
  return true;
}

function syncIaFromEnv() {
  const gateway = process.env.IA_GATEWAY;
  if (!gateway)
    return syncIaFromA8Defaults();
  store.setPlatform("IA", {
    gateway,
    token: "",
    betName:
      process.env.IA_BET_NAME
      || store.getPlatform("IA")?.betName
      || "([??].+??$)|([??\\d].+????)",
    games: getActivePlatformGameIds("IA").map(String),
  });
  return true;
}

function syncIaFromSession(_session) {
  return false;
}

function syncImtFromEnv() {
  const gateway = process.env.IMT_GATEWAY;
  const token = process.env.IMT_TOKEN;
  if (!gateway || !token)
    return false;
  const sportIds = process.env.IMT_SPORT_IDS
    ? process.env.IMT_SPORT_IDS.split(/[,;\s]+/).filter(Boolean)
    : [...new Set(getActivePlatformGameIds("IMT"))];
  store.setPlatform("IMT", {
    gateway,
    token,
    referer: process.env.IMT_REFERER || gateway,
    userAgent: process.env.IMT_USER_AGENT || "",
    xSc: process.env.IMT_X_SC || "",
    sportIds: sportIds.length ? sportIds : ["43"],
  });
  return true;
}

function syncImtFromSession(session) {
  if (!session?.gateway || !session?.token)
    return false;
  store.setPlatform("IMT", {
    gateway: session.gateway,
    token: session.token,
    referer: session.referer || session.gateway,
    userAgent: session.userAgent || "",
    xSc: session.xSc || "",
    sportIds: (session.sportIds || getActivePlatformGameIds("IMT")).map(String),
  });
  return true;
}

function syncImFromEnv() {
  store.setPlatform("IM", {
    gateway: process.env.A8_WS_URL || "",
    token: process.env.A8_SOCKET_TOKEN || "",
    betName: ".*",
    games: getActivePlatformGameIds("IM").map(String),
  });
  return true;
}

function syncXbetFromEnv() {
  store.setPlatform("XBet", {
    gateway: process.env.A8_WS_URL || "",
    token: process.env.A8_SOCKET_TOKEN || "",
    betName: ".*",
    games: getActivePlatformGameIds("XBet").map(String),
  });
  return true;
}

function syncStakeFromEnv() {
  const accessToken = process.env.STAKE_ACCESS_TOKEN || process.env.STAKE_TOKEN;
  if (!accessToken)
    return false;
  store.setPlatform("Stake", {
    gateway: process.env.STAKE_API_URL || "https://stake.com",
    accessToken,
    sports: process.env.STAKE_SPORTS
      ? process.env.STAKE_SPORTS.split(/[,;\s]+/).filter(Boolean)
      : ["dota-2", "counter-strike", "league-of-legends", "kings-of-glory", "valorant"],
  });
  return true;
}

function syncStakeFromSession(session) {
  if (!session?.accessToken)
    return false;
  store.setPlatform("Stake", {
    gateway: session.apiUrl || session.gateway,
    accessToken: session.accessToken,
    sports: session.sports || [],
  });
  return true;
}

function syncSabaFromEnv() {
  const gateway = process.env.SABA_GATEWAY;
  const token = process.env.SABA_TOKEN;
  if (!gateway || !token)
    return false;
  store.setPlatform("SABA", {
    gateway,
    token,
    games: getActivePlatformGameIds("SABA").map(String),
  });
  return true;
}

function syncSabaFromSession(session) {
  if (!session?.gateway || !session?.token)
    return false;
  store.setPlatform("SABA", {
    gateway: session.gateway,
    token: session.token,
    games: (session.gameIds || getActivePlatformGameIds("SABA")).map(String),
  });
  return true;
}

function syncHgFromEnv() {
  const gateway = process.env.HG_GATEWAY;
  const token = process.env.HG_TOKEN;
  if (!gateway || !token)
    return false;
  store.setPlatform("HG", {
    gateway,
    token: typeof token === "string" ? token : JSON.stringify(token),
  });
  return true;
}

function syncHgFromSession(session) {
  if (!session?.gateway || !session?.token)
    return false;
  store.setPlatform("HG", {
    gateway: session.gateway,
    token: JSON.stringify(session.token),
  });
  return true;
}

async function ensurePlatformCredentials() {
  store.ensureSeed();
  let obSynced = false;
  obSynced = syncObFromStore();
  if (!obSynced) {
    try {
      await syncObLogin();
      obSynced = true;
    }
    catch (err) {
      console.warn("[platform-sync] OB login failed:", err.message);
    }
  }

  let raySynced = syncRayFromA8();
  if (!raySynced) {
    raySynced = syncRayFromEnv();
  }

  let pbSynced = false;
  try {
    const { tryLoadSession } = requirePlatform("PB", "node", "session.js");
    const session = tryLoadSession();
    if (session)
      pbSynced = syncPbFromSession(session);
  }
  catch (err) {
    console.warn("[platform-sync] PB platforms.json load failed:", err.message);
  }
  if (!pbSynced) {
    pbSynced = syncPbFromEnv();
  }

  let tfSynced = syncTfFromEnv();
  if (!tfSynced) {
    tfSynced = await syncTfFromLocal();
  }

  const iaSynced = syncIaFromEnv() || syncIaFromA8Defaults();

  const imtSynced = syncImtFromEnv();

  const imSynced = syncImFromEnv();
  const xbetSynced = syncXbetFromEnv();
  const stakeSynced = syncStakeFromEnv();
  const sabaSynced = syncSabaFromEnv();
  const hgSynced = syncHgFromEnv();

  return {
    obSynced,
    raySynced,
    pbSynced,
    tfSynced,
    iaSynced,
    imtSynced,
    imSynced,
    xbetSynced,
    stakeSynced,
    sabaSynced,
    hgSynced,
  };
}

export {
  ensurePlatformCredentials,
  resolveObSession,
  syncHgFromEnv,
  syncHgFromSession,
  syncIaFromA8Defaults,
  syncIaFromEnv,
  syncIaFromSession,
  syncImFromEnv,
  syncImtFromEnv,
  syncImtFromSession,
  syncObFromSession,
  syncObFromStore,
  syncObLogin,
  syncPbFromEnv,
  syncPbFromSession,
  syncRayFromA8,
  syncRayFromEnv,
  syncRayFromSession,
  syncSabaFromEnv,
  syncSabaFromSession,
  syncStakeFromEnv,
  syncStakeFromSession,
  syncTfFromLocal,
  syncTfFromEnv,
  syncTfFromSession,
  syncTfFromLocal as syncTfFromA8,
  syncXbetFromEnv,
};
