/**
 * TF 实时 WS 探针 — A8 聚合已移除，默认不再连接任何 host。
 * 若需探测，显式传入 options.wsUrl / 环境变量 TF_WS_URL。
 */
import { backendRequire } from "../backend/_paths.js";
import { stripTokenPrefix } from "./auth.js";

const WebSocket = backendRequire("ws");

/** @deprecated A8 聚合 WS 已移除 */
export const TF_WS_HOSTS = [];
export const TF_WS_PATH = "/esport/ws/TF";

export function resetTfWsHostRotateForTests() {
  /* no-op */
}

export function nextTfWsHost() {
  throw new Error("TF A8 WebSocket hosts removed; set TF_WS_URL to probe a non-A8 endpoint");
}

/** @deprecated A8 聚合 WS 已移除；无默认 host */
export function buildTfWsUrl(_token, _host) {
  throw new Error("TF A8 WebSocket hosts removed; set TF_WS_URL to probe a non-A8 endpoint");
}

/** @deprecated 使用 buildTfWsUrl */
export function buildTfUpstreamUrl(_gateway, token) {
  return buildTfWsUrl(token);
}

/** @deprecated 使用 buildTfWsUrl */
export function buildA8StyleWsUrl(token) {
  return buildTfWsUrl(token);
}

export class TfWsClient {
  constructor(options = {}) {
    this.gateway = options.gateway || process.env.TF_GATEWAY || "";
    this.token = options.token || process.env.TF_TOKEN || "";
    this.wsUrlOverride = options.wsUrl || process.env.TF_WS_URL || "";
    this.reconnectMinMs = options.reconnectMinMs || 1000;
    this.reconnectMaxMs = options.reconnectMaxMs || 5000;
    this.ws = null;
    this.connected = false;
    this._running = false;
    this._onOdds = null;
    this.lastError = null;
    this._reconnectTimer = null;
  }

  resolveWsUrl() {
    if (this.wsUrlOverride) {
      return this.wsUrlOverride.includes("?")
        ? this.wsUrlOverride
        : `${this.wsUrlOverride}?auth_token=${stripTokenPrefix(this.token)}&combo=false`;
    }
    throw new Error("TF A8 WebSocket hosts removed; set TF_WS_URL or options.wsUrl");
  }

  onOdds(fn) {
    this._onOdds = fn;
  }

  connect() {
    if (this._running) return Promise.resolve(this.connected);
    if (!this.wsUrlOverride) {
      this.lastError = "TF WS: A8 hosts removed; set TF_WS_URL";
      return Promise.resolve(false);
    }
    if (!this.token && !this.wsUrlOverride.includes("auth_token=")) {
      this.lastError = "TF WS: missing token";
      return Promise.resolve(false);
    }

    this._running = true;
    return new Promise((resolve) => {
      let url;
      try {
        url = this.resolveWsUrl();
      }
      catch (err) {
        this.lastError = err.message;
        this._running = false;
        resolve(false);
        return;
      }
      this.ws = new WebSocket(url);

      const finish = (ok) => {
        this.connected = ok;
        resolve(ok);
      };

      this.ws.on("open", () => {
        this.lastError = null;
        finish(true);
      });

      this.ws.on("message", (data) => {
        try {
          const msg = JSON.parse(String(data));
          if (this._onOdds) this._onOdds(msg);
        }
        catch {
          /* ignore non-json */
        }
      });

      this.ws.on("error", (err) => {
        this.lastError = err.message;
        if (!this.connected) finish(false);
      });

      this.ws.on("close", () => {
        this.connected = false;
        if (this._running) this.scheduleReconnect();
      });
    });
  }

  scheduleReconnect() {
    if (this._reconnectTimer) return;
    const delay = Math.min(this.reconnectMaxMs, this.reconnectMinMs + Math.random() * 2000);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (!this._running) return;
      this.connect().catch(() => {});
    }, delay);
  }

  disconnect() {
    this._running = false;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }
}
