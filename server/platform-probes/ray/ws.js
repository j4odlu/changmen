import { backendRequire } from "../backend/_paths.js";

const socketClusterClient = backendRequire("socketcluster-client");

/** RAY 源站实时网关（ray164 前端 SocketCluster），非 A8 聚合服务器 */
export const DEFAULT_WS = {
  hostname: "cfsocket.365raylinks.com",
  path: "/socketcluster/",
  channel: "match",
};

/**
 * RAY 实时推送：SocketCluster 频道 `match`（与 ray164 前端一致）。
 * 消息格式：
 *   { source: "odds", odds: [{ id, odds, status, match_id, ... }] }
 *   { source: "match", match: { id, status, ... } }
 *
 * 禁止连接 A8 聚合服务器（如 47.115.75.57/esport/ws/RAY）。
 */
export class RayWsClient {
  constructor(options = {}) {
    this.hostname =
      options.hostname || process.env.RAY_WS_HOST || DEFAULT_WS.hostname;
    this.path = options.path || process.env.RAY_WS_PATH || DEFAULT_WS.path;
    this.channel = options.channel || process.env.RAY_WS_CHANNEL || DEFAULT_WS.channel;
    this.token = options.token || process.env.RAY_WS_TOKEN || process.env.RAY_TOKEN || "";
    this.origin = options.origin || process.env.RAY_ORIGIN || "https://ray164.com";
    this.protocolVersion = Number(options.protocolVersion || process.env.RAY_WS_PROTOCOL || 1);
    this.connectTimeoutMs = options.connectTimeoutMs || 15000;
    this.socket = null;
    this.channelRef = null;
    this._consumeLoop = null;
    this.connected = false;
    this._running = false;
    this._onOdds = null;
    this._onMatch = null;
    this.lastError = null;
  }

  get wsUrl() {
    return `wss://${this.hostname}${this.path.startsWith("/") ? this.path : `/${this.path}`}`;
  }

  onOdds(fn) {
    this._onOdds = fn;
  }

  onMatch(fn) {
    this._onMatch = fn;
  }

  async connect() {
    if (this._running && this.connected) return true;
    this._running = true;
    this.lastError = null;

    const wsOptions = {
      headers: {
        Origin: this.origin,
        Referer: `${this.origin}/`,
      },
    };
    if (this.token) {
      const auth = this.token.startsWith("Bearer ") ? this.token : `Bearer ${this.token}`;
      wsOptions.headers.Authorization = auth;
    }

    this.socket = socketClusterClient.create({
      hostname: this.hostname,
      secure: true,
      port: 443,
      path: this.path,
      protocolVersion: this.protocolVersion,
      autoConnect: true,
      connectTimeout: this.connectTimeoutMs,
      ackTimeout: 10000,
      wsOptions,
    });

    try {
      this.channelRef = this.socket.subscribe(this.channel);
      await this.channelRef.listener("subscribe").once();
      this.connected = this.socket.state === "open";
      if (!this.connected) {
        throw new Error(`SocketCluster subscribe ok but socket not open: ${this.wsUrl}`);
      }
      this._startConsumeLoop();
      return true;
    } catch (err) {
      this.lastError = err;
      this.connected = false;
      this.disconnect();
      return false;
    }
  }

  _startConsumeLoop() {
    if (!this.channelRef || this._consumeLoop) return;
    const channel = this.channelRef;
    this._consumeLoop = (async () => {
      try {
        for await (const payload of channel) {
          if (!this._running) break;
          this._dispatch(payload);
        }
      } catch (err) {
        if (this._running) {
          this.lastError = err;
          this.connected = false;
        }
      }
    })();
  }

  disconnect() {
    this._running = false;
    this.connected = false;
    this._consumeLoop = null;
    if (this.channelRef) {
      try {
        this.channelRef.unsubscribe();
      } catch {
        /* ignore */
      }
      this.channelRef = null;
    }
    if (this.socket) {
      try {
        this.socket.disconnect();
      } catch {
        /* ignore */
      }
      this.socket = null;
    }
  }

  _dispatch(payload) {
    if (!payload || typeof payload !== "object") return;
    if (payload.source === "odds" && Array.isArray(payload.odds)) {
      if (this._onOdds) this._onOdds(payload.odds, payload);
      return;
    }
    if (payload.source === "match" && payload.match) {
      if (this._onMatch) this._onMatch(payload.match, payload);
    }
  }
}
