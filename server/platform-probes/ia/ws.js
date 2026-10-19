/**
 * IA 实时 Socket.IO 探针 — A8 聚合（47.115.75.57）已移除。
 * 须显式传入 options.wsBase / IA_WS_URL（官方或本站 relay），否则不连接。
 */
import { backendRequire } from "../backend/_paths.js";

const { io } = backendRequire("socket.io-client");

/** @deprecated A8 聚合 WS 已移除；无默认基址 */
export const DEFAULT_A8_WS = "";

/**
 * IA 实时 Socket.IO（须自备非 A8 的 wsBase）。
 */
export class IaWsClient {
  constructor(options = {}) {
    this.wsBase = options.wsBase || process.env.IA_WS_URL || "";
    this.gateway = options.gateway || process.env.IA_GATEWAY || "https://pc.ilustre-analytics.org";
    this.reconnectMinMs = options.reconnectMinMs || 2000;
    this.reconnectMaxMs = options.reconnectMaxMs || 8000;
    this.socket = null;
    this.connected = false;
    this._running = false;
    this._onMessage = null;
    this.lastError = null;
  }

  onMessage(fn) {
    this._onMessage = fn;
  }

  connect() {
    if (this._running && this.connected) return Promise.resolve(true);
    if (!this.wsBase) {
      this.lastError = "IA WS: A8 hosts removed; set IA_WS_URL or options.wsBase";
      return Promise.resolve(false);
    }

    this._running = true;

    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        this.connected = ok;
        resolve(ok);
      };

      const origin = this.gateway.replace(/\/+$/, "");
      this.socket = io(this.wsBase, {
        transports: ["websocket"],
        withCredentials: true,
        path: "/esport/ws/IA",
        extraHeaders: {
          Origin: origin,
          token: "hello",
        },
        auth: {
          token: origin,
        },
        reconnection: true,
        reconnectionDelay: this.reconnectMinMs,
        reconnectionDelayMax: this.reconnectMaxMs,
      });

      this.socket.on("connect", () => {
        this.lastError = null;
        this.socket.emit("RoomJoin", { room_type: "room_type_index_content_push" });
        finish(true);
      });

      this.socket.on("roomMessageCallBack", (msg) => {
        if (this._onMessage) this._onMessage(msg);
      });

      this.socket.on("connect_error", (err) => {
        this.lastError = err.message;
        finish(false);
      });

      setTimeout(() => {
        if (!settled) finish(this.connected);
      }, 8000);
    });
  }

  disconnect() {
    this._running = false;
    this.connected = false;
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
  }
}
