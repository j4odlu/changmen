/**
 * VPS：Polymarket Sports WS → client_matches.pm_sport
 * 不改动浏览器 CLOB 采集 / saveMatch / saveBets。
 */

import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import {
  getResolvedDatabaseLabel,
  hasDatabaseUrlConfig,
  initDatabaseUrl,
  updateClientMatchPmSport,
  ensurePmPrematchSchema,
} from "@changmen/db";
import WebSocket from "ws";
import { notifyPmSportBroadcast } from "./broadcast_notify.js";
import { refreshGammaEventIndex, withGammaSportIdentity } from "./gamma_map.js";
import { applyPmSportFromMessage, pollLinkedPrematchPrices } from "./gamma_poll.js";
import { resolveClientMatchIdFromSportMessage } from "./resolve_match.js";

loadChangmenEnv();

const SPORTS_WS = "wss://sports-api.polymarket.com/ws";
const GAMMA_REFRESH_MS = 60_000;
const RECONNECT_MS = 5_000;

/** @type {{ byGameId: Map<number, object>, bySlug: Map<string, object> }} */
let gammaIndex = { byGameId: new Map(), bySlug: new Map() };
let ws = null;
let reconnectTimer = null;
let stopped = false;
/** @type {Map<number, number>} gameId -> last unresolved log ts */
const unresolvedLogAt = new Map();
const UNRESOLVED_LOG_MS = 60_000;

async function writePmSport(clientMatchId, snapshot) {
  const ok = await updateClientMatchPmSport(clientMatchId, snapshot);
  if (ok)
    void notifyPmSportBroadcast(clientMatchId, snapshot);
  return ok;
}

async function refreshGamma() {
  try {
    gammaIndex = await refreshGammaEventIndex();
    console.log(
      `[pm-sports] Gamma index: gameIds=${gammaIndex.byGameId.size} slugs=${gammaIndex.bySlug.size}`,
    );
  }
  catch (err) {
    console.warn("[pm-sports] Gamma refresh failed:", err.message);
  }
}

let prematchPollRunning = false;
async function runPrematchPoll() {
  if (prematchPollRunning || stopped) return;
  prematchPollRunning = true;
  try {
    const n = await pollLinkedPrematchPrices();
    if (n) console.log(`[pm-prematch] saved ${n} token snapshot(s)`);
  }
  catch (err) { console.warn("[pm-prematch] poll failed:", err.message); }
  finally { prematchPollRunning = false; }
}

async function handleSportMessage(raw) {
  if (raw === "ping") {
    ws?.send("pong");
    return;
  }
  let msg;
  try {
    msg = JSON.parse(raw);
  }
  catch {
    return;
  }
  if (!msg || msg.gameId == null)
    return;

  const gameId = Number(msg.gameId);
  if (!Number.isFinite(gameId))
    return;

  const clientMatchId = await resolveClientMatchIdFromSportMessage(msg, gammaIndex);
  if (!clientMatchId) {
    const now = Date.now();
    const last = unresolvedLogAt.get(gameId) || 0;
    if (now - last >= UNRESOLVED_LOG_MS) {
      unresolvedLogAt.set(gameId, now);
      console.warn(
        `[pm-sports] unresolved gameId=${gameId} slug=${msg.slug || ""} status=${msg.status || ""} teams=${msg.homeTeam || ""} vs ${msg.awayTeam || ""}`,
      );
    }
    return;
  }

  const sportMessage = withGammaSportIdentity(msg, gammaIndex);
  const ok = await applyPmSportFromMessage(clientMatchId, sportMessage, async (id, snapshot) => {
    const written = await writePmSport(id, snapshot);
    if (written) {
      console.log(
        `[pm-sports] ws cm=${id} gameId=${gameId} ${snapshot.label || snapshot.status || ""}`,
      );
    }
    return written;
  });
  if (!ok)
    return;
}

function connectWs() {
  if (stopped || ws)
    return;

  ws = new WebSocket(SPORTS_WS);

  ws.on("open", () => {
    console.log("[pm-sports] Sports WS connected");
  });

  ws.on("message", (data) => {
    void handleSportMessage(String(data)).catch(err => {
      console.warn("[pm-sports] handle message:", err.message);
    });
  });

  ws.on("close", () => {
    ws = null;
    if (!stopped) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectWs();
      }, RECONNECT_MS);
    }
  });

  ws.on("error", () => {
    ws?.close();
  });
}

async function main() {
  if (!hasDatabaseUrlConfig()) {
    console.error("[pm-sports] DATABASE_URL / DATABASE_URL_PUBLIC / DATABASE_URL_INTERNAL 未配置");
    process.exit(1);
  }
  // VPS：auto 优先内网；本机：内网不可达则走 public / DATABASE_URL
  await initDatabaseUrl();
  console.log(`[pm-sports] RDS ${getResolvedDatabaseLabel() || "DATABASE_URL"}`);
  await ensurePmPrematchSchema();

  await refreshGamma();
  void runPrematchPoll();
  setInterval(() => { void runPrematchPoll(); }, 60_000);
  setInterval(() => {
    void refreshGamma();
  }, GAMMA_REFRESH_MS);

  connectWs();

  const shutdown = () => {
    stopped = true;
    if (reconnectTimer)
      clearTimeout(reconnectTimer);
    ws?.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[pm-sports] fatal:", err);
  process.exit(1);
});
