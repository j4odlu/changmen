#!/usr/bin/env node
/**
 * OB 混合采集探针：HTTP 轮询（game/index + game/view + getTimer）+ MQTT 订阅。
 * 对齐 changmen 前端 / A8 UMe 语义（每局 unsub→view→sub，stage 间隔 1.5s，处理 3 个 /market/*）。
 *
 * Usage:
 *   node platforms/ob/scripts/ob_collect_hybrid.js
 *   node platforms/ob/scripts/ob_collect_hybrid.js --duration 90 --max-matches 3
 *   node platforms/ob/scripts/ob_collect_hybrid.js --platforms data/esport/platforms.json
 *   node platforms/ob/scripts/ob_collect_hybrid.js --mqtt-mode native
 *   node platforms/ob/scripts/ob_collect_hybrid.js --jsonl ./ob_probe.jsonl
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { backendRequire } from "../../backend/_paths.js";
import * as Core from "../core.js";
import { login, obGet, fetchGetTimer, DEFAULT_LOGIN_URL } from "../session.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mqtt = backendRequire("mqtt");

const STAGE_INTERVAL_MS = 1500;
const DEFAULT_POLL_MS = 30_000;
const OB_MQTT_CLIENT_ID = "mqttjs_dj1250901313125773543";

function parseArgs(argv) {
  const out = {
    durationSec: 90,
    maxMatches: 5,
    pollMs: DEFAULT_POLL_MS,
    matchConcurrency: 1,
    platformsPath: path.join(__dirname, "../../../data/esport/platforms.json"),
    mqttMode: "auto",
    jsonl: "",
    loginUrl: process.env.OB_LOGIN_URL || "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const val = argv[i + 1];
    if (key === "--duration" && val) out.durationSec = Number(val) || 90;
    else if (key === "--max-matches" && val) out.maxMatches = Number(val) || 5;
    else if (key === "--poll-ms" && val) out.pollMs = Number(val) || DEFAULT_POLL_MS;
    else if (key === "--concurrency" && val) out.matchConcurrency = Math.max(1, Number(val) || 1);
    else if (key === "--platforms" && val) out.platformsPath = path.resolve(val);
    else if (key === "--mqtt-mode" && val) out.mqttMode = val;
    else if (key === "--jsonl" && val) out.jsonl = path.resolve(val);
    else if (key === "--login-url" && val) out.loginUrl = val;
  }
  return out;
}

function logEvent(sink, event) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event });
  process.stdout.write(`${line}\n`);
  if (sink) fs.appendFileSync(sink, `${line}\n`, "utf8");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseOddValue(v) {
  if (v && typeof v.toNumber === "function") return v.toNumber();
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function loadPlatformsOb(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const ob = raw?.OB;
  if (!ob?.gateway || !ob?.token) return null;
  return {
    gateway: ob.gateway,
    token: ob.token,
    lang: "cn",
    betName: ob.betName || ".*",
    games: Array.isArray(ob.games) ? ob.games.map(String) : [],
  };
}

async function resolveSession(args) {
  const fromFile = loadPlatformsOb(args.platformsPath);
  const loginRes = await login(args.loginUrl || undefined);
  const gateway = fromFile?.gateway || loginRes.gateway;
  const token = fromFile?.token || loginRes.token;
  const lang = loginRes.lang || "cn";
  if (!gateway || !token) throw new Error("No OB gateway/token");

  const indexProbe = await obGet(gateway, "/game/index?game_id=0&flag=1&day=1", token, lang);
  if (indexProbe.json.status === "false" && indexProbe.json.data === "token") {
    const fresh = await login(args.loginUrl || DEFAULT_LOGIN_URL);
    return {
      gateway: fresh.gateway,
      token: fresh.token,
      lang: fresh.lang,
      mqtt: fresh.mqtt,
      mqttEndpoints: fresh.mqttEndpoints,
      betName: fromFile?.betName || ".*",
      games: fromFile?.games?.length ? fromFile.games : [],
      tokenSource: "login_refresh",
    };
  }

  return {
    gateway,
    token,
    lang,
    mqtt: loginRes.mqtt,
    mqttEndpoints: loginRes.mqttEndpoints,
    betName: fromFile?.betName || ".*",
    games: fromFile?.games?.length ? fromFile.games : [],
    tokenSource: fromFile ? "platforms.json+login_mqtt" : "login",
  };
}

function resolveMqttConnect(session, args) {
  const native = session.mqtt || session.mqttEndpoints?.[0];
  if (args.mqttMode === "native" && !native) {
    throw new Error("No native MQTT URL in login session");
  }
  if (native || args.mqttMode === "auto") {
    if (!native && args.mqttMode === "auto") return null;
    return {
      url: native,
      options: {
        clientId: OB_MQTT_CLIENT_ID,
        username: session.token,
        protocolId: "MQTT",
        protocolVersion: 4,
        reconnectPeriod: 5000,
        keepalive: 60,
      },
      source: "native",
    };
  }
  return null;
}

function filterIndexRows(matches, games) {
  const now = Date.now();
  const horizon = now + 3600 * 1000;
  return matches.filter((m) => {
    if (games.length && !games.includes(String(m.gameId))) return false;
    return m.startTime <= horizon;
  });
}

function stageIdsForBo(bo) {
  const n = Number(bo) || 1;
  if (n <= 1) return [0];
  return Array.from({ length: n + 1 }, (_, i) => i);
}

async function httpPollRound(session, args, sink, state) {
  const { gateway, token, lang, betName, games } = session;
  const betRe = new RegExp(betName || ".*");
  const t0 = Date.now();

  const index = await obGet(gateway, "/game/index?game_id=0&flag=1&day=1", token, lang);
  if (index.json.status === "false") {
    logEvent(sink, {
      type: "http.index.fail",
      data: index.json.data,
      ms: Date.now() - t0,
    });
    return { ok: false };
  }

  const all = Core.normalizeGameIndex(index.json);
  const list = filterIndexRows(all, games).slice(0, args.maxMatches);
  logEvent(sink, {
    type: "http.index.ok",
    total: all.length,
    selected: list.length,
    ms: Date.now() - t0,
  });

  for (const m of list) {
    const matchId = String(m.matchId);
    const topics = Core.mqttTopicsForMatch(matchId);
    if (state.mqttClient?.connected) {
      state.mqttClient.unsubscribe(topics);
    }

    const markets = [];
    let hadError = false;
    for (const stageId of stageIdsForBo(m.bo)) {
      try {
        const view = await obGet(
          gateway,
          `/game/view?match_id=${matchId}&stage_id=${stageId}`,
          token,
          lang,
        );
        if (view.json.status === "true") {
          const normalized = Core.normalizeGameView(matchId, stageId, view.json);
          for (const mk of normalized) {
            const label = mk.marketName || "";
            if (mk.status === 12 || mk.visible === 0) continue;
            if (!betRe.test(label)) continue;
            markets.push(mk);
            for (const o of mk.odds || []) {
              if (o.oddsId) state.oddsBaseline.set(String(o.oddsId), parseOddValue(o.odd));
            }
          }
        }
      } catch (err) {
        hadError = true;
        logEvent(sink, {
          type: "http.view.error",
          matchId,
          stageId,
          message: err.message,
        });
      } finally {
        await sleep(STAGE_INTERVAL_MS);
      }
    }

    logEvent(sink, {
      type: "http.match.done",
      matchId,
      bo: m.bo,
      markets: markets.length,
      hadError,
      home: m.home,
      away: m.away,
    });

    if (state.mqttClient?.connected) {
      await new Promise((resolve) => {
        state.mqttClient.subscribe(topics, (err) => {
          logEvent(sink, {
            type: "mqtt.subscribe",
            matchId,
            ok: !err,
            topics: topics.length,
          });
          resolve();
        });
      });
    }
  }

  try {
    const timer = await fetchGetTimer(session);
    const n = timer.timers ? Object.keys(timer.timers).length : 0;
    logEvent(sink, { type: "http.getTimer.ok", timers: n });
  } catch (err) {
    logEvent(sink, { type: "http.getTimer.error", message: err.message });
  }

  logEvent(sink, { type: "http.round.done", ms: Date.now() - t0, oddsTracked: state.oddsBaseline.size });
  return { ok: true };
}

function startMqtt(session, args, sink, state) {
  const cfg = resolveMqttConnect(session, args);
  if (!cfg) {
    logEvent(sink, { type: "mqtt.skip", reason: "no_native_mqtt_url" });
    return null;
  }

  const client = mqtt.connect(cfg.url, cfg.options);
  state.mqttClient = client;

  client.on("connect", () => {
    logEvent(sink, { type: "mqtt.connect", url: cfg.url, source: cfg.source });
  });

  client.on("error", (err) => {
    logEvent(sink, { type: "mqtt.error", message: err.message });
  });

  client.on("message", (topic, buf) => {
    state.mqttMessages += 1;
    let rows;
    try {
      rows = JSON.parse(buf.toString());
    } catch {
      return;
    }
    if (!Array.isArray(rows)) return;

    const m = /^(\/market\/[^/]+\/)(\d+)$/.exec(topic);
    const prefix = m ? m[1] : topic;
    const matchId = m ? m[2] : "";

    switch (prefix) {
      case "/market/oddsUpdate/":
        for (const row of rows) {
          const id = String(row.id ?? "");
          if (!id || !state.oddsBaseline.has(id)) continue;
          const odd = parseOddValue(row.odd);
          if (odd > 0) state.oddsBaseline.set(id, odd);
          state.mqttOddsUpdates += 1;
        }
        break;
      case "/market/statusUpdate/":
        state.mqttLockEvents += rows.length;
        break;
      case "/market/suspended/":
        state.mqttSuspendEvents += rows.length;
        break;
      default:
        break;
    }

    if (state.mqttMessages <= 5 || state.mqttMessages % 20 === 0) {
      logEvent(sink, {
        type: "mqtt.message",
        topic: prefix,
        matchId,
        count: rows.length,
        totalMessages: state.mqttMessages,
      });
    }
  });

  return client;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sink = args.jsonl || "";
  if (sink) fs.writeFileSync(sink, "", "utf8");

  const state = {
    oddsBaseline: new Map(),
    mqttClient: null,
    mqttMessages: 0,
    mqttOddsUpdates: 0,
    mqttLockEvents: 0,
    mqttSuspendEvents: 0,
  };

  logEvent(sink, { type: "probe.start", args: { ...args, platformsPath: args.platformsPath } });

  const session = await resolveSession(args);
  logEvent(sink, {
    type: "session.ready",
    gateway: session.gateway,
    tokenSource: session.tokenSource,
    mqtt: session.mqtt || null,
    games: session.games.length,
  });

  startMqtt(session, args, sink, state);

  const deadline = Date.now() + args.durationSec * 1000;
  let round = 0;
  while (Date.now() < deadline) {
    round += 1;
    logEvent(sink, { type: "poll.round", round });
    await httpPollRound(session, args, sink, state);
    const remain = deadline - Date.now();
    if (remain <= 0) break;
    await sleep(Math.min(args.pollMs, remain));
  }

  if (state.mqttClient) {
    state.mqttClient.end(true);
  }

  logEvent(sink, {
    type: "probe.done",
    rounds: round,
    oddsTracked: state.oddsBaseline.size,
    mqttMessages: state.mqttMessages,
    mqttOddsUpdates: state.mqttOddsUpdates,
    mqttLockEvents: state.mqttLockEvents,
    mqttSuspendEvents: state.mqttSuspendEvents,
  });
}

main().catch((err) => {
  console.error(JSON.stringify({ type: "probe.fatal", message: err.message, stack: err.stack }));
  process.exit(1);
});
