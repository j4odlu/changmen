"use strict";

const fs = require("fs");
const path = require("path");
const { ESPORT_DATA_DIR } = require("../backend/_paths.cjs");

const PLATFORMS_FILE = path.join(ESPORT_DATA_DIR, "platforms.json");

function normalizeGateway(gateway) {
  return String(gateway || "").replace(/\/+$/, "");
}

function parseToken(token) {
  if (!token) return null;
  if (typeof token === "object") return token;
  try {
    return JSON.parse(token);
  } catch {
    return null;
  }
}

function loadFromPlatformsJson() {
  try {
    if (!fs.existsSync(PLATFORMS_FILE)) return null;
    const all = JSON.parse(fs.readFileSync(PLATFORMS_FILE, "utf8"));
    const row = all.HG;
    if (!row?.gateway || !row?.token) return null;
    return buildSessionFromRow(row);
  } catch {
    return null;
  }
}

function loadFromEnv() {
  const gateway = process.env.HG_GATEWAY;
  const token = process.env.HG_TOKEN;
  if (!gateway || !token) return null;
  return buildSessionFromRow({ gateway, token });
}

function buildSessionFromRow(row) {
  const cred = parseToken(row.token);
  if (!cred?.uid || !cred?.ver) return null;
  const gateway = normalizeGateway(row.gateway);
  return {
    provider: "HG",
    gateway,
    token: cred,
    transformUrl: `${gateway}/transform.php?ver=${cred.ver}`,
  };
}

function tryLoadSession() {
  return loadFromEnv() || loadFromPlatformsJson();
}

function formBody(params) {
  return new URLSearchParams(params).toString();
}

async function hgPost(session, params) {
  const res = await fetch(session.transformUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody(params),
  });
  if (!res.ok) {
    throw new Error(`HG transform HTTP ${res.status}`);
  }
  return res.text();
}

function xmlTag(text, tag) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i");
  const m = re.exec(text || "");
  return m ? m[1].trim() : null;
}

function parseMemberData(xml) {
  const code = xmlTag(xml, "code");
  if (code === "error") {
    const msg = xmlTag(xml, "msg") || "HG 账户接口错误";
    throw new Error(msg);
  }
  return {
    currency: xmlTag(xml, "currency") || "",
    balance: Number(xmlTag(xml, "maxcredit") || 0),
    username: xmlTag(xml, "username") || "",
  };
}

async function fetchBalance(session) {
  const xml = await hgPost(session, {
    p: "get_member_data",
    uid: session.token.uid,
    ver: session.token.ver,
    langx: "zh-cn",
    change: "all",
  });
  return parseMemberData(xml);
}

async function ensureOddsTypeEurope(session) {
  const xml = await hgPost(session, {
    p: "memSet",
    ver: session.token.ver,
    uid: session.token.uid,
    val: '{"odd_f_type":"E"}',
    langx: "zh-cn",
    action: "send",
  });
  return xml.trim() === "1";
}

function persistPlatform(session, account) {
  try {
    const dir = path.dirname(PLATFORMS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let all = {};
    if (fs.existsSync(PLATFORMS_FILE)) {
      all = JSON.parse(fs.readFileSync(PLATFORMS_FILE, "utf8"));
    }
    all.HG = {
      gateway: session.gateway,
      token: JSON.stringify(session.token),
      username: account?.username,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(PLATFORMS_FILE, JSON.stringify(all, null, 2));
  } catch {
    /* ignore */
  }
}

module.exports = {
  tryLoadSession,
  fetchBalance,
  ensureOddsTypeEurope,
  persistPlatform,
};
