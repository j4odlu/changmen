"use strict";


const { backendRequire } = require("./_require.js");
const { io } = backendRequire("socket.io-client");
const Core = require("./core.js");

const SUBSCRIBE_ODDS = [
  [
    "odds",
    {
      spread: [
        {
          id: "c0",
          rev: "DM4WT",
          sorting: 0,
          condition: {},
          r: "c1627df7-r3928",
          p: "d530b060d500b34b-b2074",
        },
      ],
      odds: [
        {
          id: "c2",
          rev: "Gwz9v",
          sorting: "n",
          condition: {},
          r: "c1627df7-r3928",
          p: "d530b060d500b34b-b2074",
        },
      ],
    },
  ],
];

class SabaWsClient {
  constructor(config, handlers = {}) {
    this.config = config;
    this.handlers = handlers;
    this.socket = null;
    this.fieldMap = [];
    this.connected = false;
    this.lastError = null;
  }

  connect() {
    const { wsHost, gid, token, id, rid, ext, origin } = this.config;
    const url = wsHost.startsWith("wss://") ? wsHost : `wss://${wsHost}`;

    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        this.connected = ok;
        resolve(ok);
      };

      this.socket = io(url, {
        transports: ["websocket"],
        withCredentials: true,
        extraHeaders: { Origin: origin },
        query: { gid, token, id, rid, ext: String(ext) },
      });

      this.socket.on("connect", () => {
        this.socket.emit("init", {
          gid,
          token,
          id,
          rid,
          ext,
          dr: "transport close",
          rc: 1,
          v: 2,
        });
      });

      this.socket.on("init", () => {
        this.socket.emit("subscribe", SUBSCRIBE_ODDS);
        finish(true);
      });

      this.socket.on("m", (type, batches) => {
        if (!Array.isArray(batches)) return;
        for (const batch of batches) {
          this.handleBatch(batch);
        }
      });

      this.socket.on("err", (msg) => {
        this.lastError = String(msg);
        if (this.handlers.onError) this.handlers.onError(msg);
      });

      this.socket.on("disconnect", () => {
        this.connected = false;
        if (this.handlers.onDisconnect) this.handlers.onDisconnect();
      });

      this.socket.on("connect_error", (err) => {
        this.lastError = err.message;
        finish(false);
      });

      setTimeout(() => finish(this.connected), 15000);
    });
  }

  handleBatch(batch) {
    if (!Array.isArray(batch)) return;
    const [head, ...rest] = batch;
    if (head === "f") {
      const [baseIndex, names] = rest;
      if (Array.isArray(names)) {
        names.forEach((name, idx) => {
          this.fieldMap[Number(baseIndex) + idx] = name;
        });
      }
      return;
    }
    if (head !== 0) return;
    const [cmd, ...payload] = rest;
    switch (cmd) {
      case "reset":
        if (this.handlers.onReset) this.handlers.onReset();
        break;
      case "done":
        if (this.handlers.onDone) this.handlers.onDone();
        break;
      case "m":
        if (this.handlers.onMatch) {
          this.handlers.onMatch(Core.decodePairMessage(payload, this.fieldMap));
        }
        break;
      case "-m":
        if (this.handlers.onMatchRemove) {
          const row = Core.decodePairMessage(payload, this.fieldMap);
          if (row?.matchid) this.handlers.onMatchRemove(String(row.matchid));
        }
        break;
      case "o":
        if (this.handlers.onOdds) {
          this.handlers.onOdds(Core.decodePairMessage(payload, this.fieldMap));
        }
        break;
      case "-o":
        if (this.handlers.onOddsLock) {
          const row = Core.decodePairMessage(payload, this.fieldMap);
          if (row?.oddsid) this.handlers.onOddsLock(String(row.oddsid));
        }
        break;
      default:
        break;
    }
  }

  disconnect() {
    this.connected = false;
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
  }
}

module.exports = { SabaWsClient };
