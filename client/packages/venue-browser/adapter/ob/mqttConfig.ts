/** OB MQTT：官方 demo / CHANGMEN ws-forward（不再连接 A8 聚合机） */
export const OB_WS_FORWARD_PATH = "/esport/ws-forward/OB";

export const OB_MQTT_CLIENT_ID = "mqttjs_dj1250901313125773543";
export const OB_OFFICIAL_MQTT_CLIENT_ID_PREFIX = "mqttjs_dj";

/** 官方 / CHANGMEN 共用 MQTT 账密（历史命名保留） */
export const OB_A8_MQTT_USERNAME = "admin";
export const OB_A8_MQTT_PASSWORD = "Qazqaz123...";

export const OB_MQTT_CONNECT_TIMEOUT_MS = 15_000;

export function buildObOfficialMqttClientId(memberId: string): string {
  return `${OB_OFFICIAL_MQTT_CLIENT_ID_PREFIX}${String(memberId).trim()}`;
}
