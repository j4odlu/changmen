#!/usr/bin/env node
/**
 * OB realtime odds via MQTT over WebSocket.
 */

import { backendRequire } from "../../backend/_paths.js";
import * as Core from "../core.js";
import { login, fetchGameView } from "../session.js";

const mqtt = backendRequire("mqtt");

function parseArgs(argv) {
  const out = {
    matchId: "",
    stageId: 0,
    durationSec: 120,
    mqttUrl: process.env.OB_MQTT_URL || "",
  };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const val = argv[i + 1];
    if (key === "--match") out.matchId = val;
    if (key === "--stage") out.stageId = Number(val);
    if (key === "--duration") out.durationSec = Number(val);
    if (key === "--mqtt") out.mqttUrl = val;
  }
  return out;
}

function resolveMqttOptions(session, args) {
  if (args.mqttUrl) {
    return {
      url: args.mqttUrl,
      options: {
        clientId: `mqttjs_ob_${Date.now()}`,
        username: session.token,
        protocolId: "MQTT",
        protocolVersion: 4,
        reconnectPeriod: 5000,
        keepalive: 60,
      },
      source: "custom",
    };
  }

  const native = session.mqtt || session.mqttEndpoints?.[0];
  if (!native) throw new Error("No native MQTT endpoint in login session");
  return {
    url: native,
    options: {
      clientId: `mqttjs_ob_${Date.now()}`,
      username: session.token,
      protocolId: "MQTT",
      protocolVersion: 4,
      reconnectPeriod: 5000,
      keepalive: 60,
    },
    source: "native",
  };
}

function logEvent(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.matchId) {
    console.error(
      "Usage: node fetch_ob_mqtt.js --match MATCH_ID [--stage N] [--duration SEC] [--mqtt URL]",
    );
    process.exit(1);
  }

  const session = await login();
  const view = await fetchGameView(session, args.matchId, args.stageId);
  const state = { currentOdds: Core.buildOddsBaseline(view.markets) };
  const mqttCfg = resolveMqttOptions(session, args);
  const topics = Core.mqttTopicsForMatch(args.matchId);

  logEvent({
    type: "session.ready",
    matchId: args.matchId,
    stageId: args.stageId,
    gateway: session.gateway,
    mqtt: mqttCfg.url,
    mqttSource: mqttCfg.source,
    baselineOdds: Object.keys(state.currentOdds).length,
    topics,
    durationSec: args.durationSec,
  });

  await new Promise((resolve, reject) => {
    const client = mqtt.connect(mqttCfg.url, mqttCfg.options);
    let closed = false;

    const shutdown = (reason) => {
      if (closed) return;
      closed = true;
      logEvent({ type: "session.end", reason, messageCount });
      client.end(true, () => resolve());
    };

    let messageCount = 0;

    client.on("connect", () => {
      logEvent({ type: "mqtt.connected", url: mqttCfg.url, source: mqttCfg.source });
      client.subscribe(topics, (err) => {
        if (err) {
          reject(err);
          return;
        }
        logEvent({ type: "mqtt.subscribed", topics });
      });
    });

    client.on("message", (topic, buf) => {
      messageCount += 1;
      const receivedAt = Date.now();
      let payload;
      try {
        payload = JSON.parse(buf.toString());
      } catch {
        logEvent({ type: "mqtt.raw", topic, text: buf.toString(), receivedAt });
        return;
      }

      const topicInfo = Core.parseMqttTopic(topic);
      const changes = Core.applyMqttPayload(state, topicInfo, payload, receivedAt);
      if (changes.length) {
        changes.forEach((change) => logEvent({ type: "update", topic, topicType: topicInfo.type, ...change }));
      } else {
        logEvent({ type: "mqtt.message", topic, topicType: topicInfo.type, payload, receivedAt });
      }
    });

    client.on("error", (err) => {
      logEvent({ type: "mqtt.error", error: err.message });
    });

    client.on("close", () => shutdown("close"));
    client.on("offline", () => logEvent({ type: "mqtt.offline" }));

    process.on("SIGINT", () => shutdown("sigint"));
    setTimeout(() => shutdown("duration"), Math.max(5, args.durationSec) * 1000);
  });
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message }, null, 2));
  process.exit(1);
});
