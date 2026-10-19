import * as Core from "./core.js";

export const DEFAULT_LOGIN_URL =
  "https://djtop-capi.v662n.com/cApi/v2/member/login?merchant=6107384714184464&demo=1";

export function obHeaders(token, lang) {
  return { device: "1", lang: lang || "cn", token };
}

export function obPostHeaders(token, lang) {
  return {
    ...obHeaders(token, lang),
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  };
}

export async function obGet(base, path, token, lang) {
  const url = `${base.replace(/\/$/, "")}${path}`;
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 800));
    try {
      const res = await fetch(url, {
        headers: obHeaders(token, lang),
        signal: AbortSignal.timeout(20000),
      });
      const text = await res.text();
      if (!text.trim()) {
        throw new Error(`Empty response from ${url} (HTTP ${res.status})`);
      }
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 200)}`);
      }
      return { url, status: res.status, json };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

export async function obPost(base, path, token, lang, body) {
  const url = `${base.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: obPostHeaders(token, lang),
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 200)}`);
  }
  return { url, status: res.status, json };
}

export async function pickGateway(apis, token, lang) {
  let lastErr;
  for (const base of apis) {
    try {
      const r = await obGet(base, "/game/index?game_id=0&flag=1&day=1", token, lang);
      if (r.json.status === "true" || Array.isArray(r.json.data)) return base;
      if (r.json.status !== "false") return base;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("No reachable OB API gateway");
}

export async function fetchObLogin(loginUrl) {
  const res = await fetch(loginUrl, { signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(`Empty OB login response (HTTP ${res.status}) from ${loginUrl}`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Invalid OB login JSON: ${text.slice(0, 200)}`);
  }
  return { httpStatus: res.status, loginUrl, json };
}

export function buildSession(loginUrl, body) {
  if (body.status !== "true" || !body.data) {
    throw new Error(body.data || body.msg || "login failed");
  }

  const { token, pc, h5 } = body.data;
  const pcEntry = pc ? Core.parseObEntryUrl(pc) : null;
  const h5Entry = h5 ? Core.parseObEntryUrl(h5) : null;
  const entry = pcEntry || h5Entry;

  return {
    fetchedAt: new Date().toISOString(),
    provider: "OB",
    loginUrl,
    token: token || entry?.token || "",
    lang: entry?.lang || "cn",
    pc,
    h5,
    gateway: (entry?.addr?.api || [])[0] || null,
    gateways: entry?.addr?.api || [],
    mqtt: (entry?.addr?.mqtt || [])[0] || null,
    mqttEndpoints: entry?.addr?.mqtt || [],
    headers: {
      device: "1",
      lang: entry?.lang || "cn",
      token: token || entry?.token || "",
    },
  };
}

export async function login(loginUrl) {
  const url = loginUrl || process.env.OB_LOGIN_URL || DEFAULT_LOGIN_URL;
  const { httpStatus, json } = await fetchObLogin(url);
  if (json.status !== "true") {
    const err = new Error(json.data || json.msg || "login failed");
    err.response = json;
    err.httpStatus = httpStatus;
    err.loginUrl = url;
    throw err;
  }
  const session = buildSession(url, json);
  session.httpStatus = httpStatus;
  session.gateway = await pickGateway(session.gateways, session.token, session.lang);
  return session;
}

export async function fetchGameView(session, matchId, stageId) {
  const path = `/game/view?match_id=${matchId}&stage_id=${stageId}`;
  const result = await obGet(session.gateway, path, session.token, session.lang);
  if (result.json.status === "false") {
    const err = new Error(result.json.data || "game/view failed");
    err.url = result.url;
    throw err;
  }
  return {
    ...result,
    markets: Core.normalizeGameView(matchId, stageId, result.json),
  };
}

export async function fetchGetTimer(session) {
  const result = await obGet(session.gateway, "/game/getTimer", session.token, session.lang);
  if (result.json.status === "false") {
    return { ...result, timers: {} };
  }
  return {
    ...result,
    timers: Core.normalizeGetTimer(result.json),
  };
}
