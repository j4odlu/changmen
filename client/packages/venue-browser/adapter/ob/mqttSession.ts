import { OB_DEMO_LOGIN_URL } from "./constants";
import { directGet } from "@changmen/client-core/shared/http";
import { changmenHttpBaseToWs, resolveChangmenWsBase } from "../shared/changmenWsBase";
import {
  OB_A8_MQTT_PASSWORD,
  OB_A8_MQTT_USERNAME,
  OB_WS_FORWARD_PATH,
  buildObOfficialMqttClientId,
} from "./mqttConfig";

export type ObMqttEndpointSource = "demo" | "changmen";

export type ObMqttConnectConfig = {
  url: string;
  username: string;
  password?: string;
  clientId?: string;
  memberId?: string;
  source: ObMqttEndpointSource;
};

type ObEntry = {
  token: string;
  lang: string;
  gateways: string[];
  mqttEndpoints: string[];
};

function decodeBase64Json(value: string): Record<string, unknown> {
  const decoded = decodeURIComponent(String(value));
  return JSON.parse(atob(decoded)) as Record<string, unknown>;
}

/** 对齐 `@changmen/platform-probes/ob/core.js` parseObEntryUrl */
function parseObEntryUrl(rawUrl: string): ObEntry {
  const url = new URL(rawUrl);
  const addrRaw = url.searchParams.get("addr") || "";
  const addr = addrRaw ? decodeBase64Json(addrRaw) : {};
  const gateways = Array.isArray((addr as { api?: unknown }).api)
    ? ((addr as { api: unknown[] }).api.map(String).filter(Boolean))
    : [];
  const mqtt = Array.isArray((addr as { mqtt?: unknown }).mqtt)
    ? ((addr as { mqtt: unknown[] }).mqtt.map(String).filter(Boolean))
    : [];
  return {
    token: url.searchParams.get("token") || "",
    lang: url.searchParams.get("lang") || "cn",
    gateways,
    mqttEndpoints: mqtt,
  };
}

function obHeaders(token: string, lang: string): Record<string, string> {
  return { device: "1", lang: lang || "cn", token };
}

function memberIdFromPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const obj = payload as Record<string, unknown>;
  const data = obj.data && typeof obj.data === "object" ? (obj.data as Record<string, unknown>) : obj;
  for (const key of ["uid", "member_id", "memberId", "id"]) {
    const value = data[key];
    if (value != null && value !== "") return String(value).trim();
  }
  return "";
}

async function fetchObDemoMemberId(entry: ObEntry, token: string): Promise<string> {
  for (const gateway of entry.gateways) {
    try {
      const body = await directGet<unknown>(
        `${gateway.replace(/\/$/, "")}/game/balance`,
        obHeaders(token, entry.lang),
      );
      const memberId = memberIdFromPayload(body);
      if (memberId) return memberId;
    } catch {
      /* try next gateway */
    }
  }
  return "";
}

/**
 * CHANGMEN：服务端透明中继到官方 demo MQTT（`?u=` 传官方 wss 地址）。
 * 浏览器 mqtt 选项与 demo 相同，仅 url 不同。
 */
export function getObChangmenMqttConfig(
  officialDemoUrl: string,
  officialConfig: Pick<ObMqttConnectConfig, "clientId" | "memberId">,
): ObMqttConnectConfig {
  const base = changmenHttpBaseToWs(resolveChangmenWsBase());
  const forwardUrl = `${base}${OB_WS_FORWARD_PATH}?u=${encodeURIComponent(officialDemoUrl)}`;
  return {
    url: forwardUrl,
    username: OB_A8_MQTT_USERNAME,
    password: OB_A8_MQTT_PASSWORD,
    clientId: officialConfig.clientId,
    memberId: officialConfig.memberId,
    source: "changmen",
  };
}

/**
 * 试玩 login 返回的 OB 源站 MQTT（clientId = mqttjs_dj{memberId}）。
 * 每次调用都会重新请求 login，用于地址刷新。
 */
export async function fetchObDemoMqttConfig(): Promise<ObMqttConnectConfig | null> {
  let mqttEndpoints: string[] = [];
  let entry: ObEntry | null = null;
  let token = "";
  try {
    const body = await directGet<{ status?: string; data?: { pc?: string; token?: string } }>(
      OB_DEMO_LOGIN_URL,
      {},
    );
    if (body?.data?.pc) {
      entry = parseObEntryUrl(body.data.pc);
      mqttEndpoints = entry.mqttEndpoints;
      token = String(body.data?.token || entry.token || "").trim();
    }
  } catch (err) {
    console.warn("[OB MQTT] fetch demo mqtt endpoints failed", err);
    return null;
  }

  const url = mqttEndpoints[0];
  if (!url || !entry || !token) return null;
  const memberId = await fetchObDemoMemberId(entry, token);
  if (!memberId) return null;
  return {
    url,
    username: OB_A8_MQTT_USERNAME,
    password: OB_A8_MQTT_PASSWORD,
    clientId: buildObOfficialMqttClientId(memberId),
    memberId,
    source: "demo",
  };
}

/** @deprecated 使用 fetchObDemoMqttConfig */
export async function resolveObMqttConnectConfig(): Promise<ObMqttConnectConfig | null> {
  return fetchObDemoMqttConfig();
}
