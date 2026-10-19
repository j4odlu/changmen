/** Predict.fun REST — 按 PF_HTTP_MODE：direct 浏览器直连 / vps 经 changmen http-relay */

import { directGet, directPostJson } from "@changmen/client-core/shared/http";
import { changmenRelayHttpRequest, parseJsonLoose } from "@changmen/client-core/shared/platformHttp";

import { resolvePfHttpMode } from "./pfTransportMode";

const PREDICT_FUN_RELAY_ORIGIN = "https://predict.fun/";

export function resolvePredictFunApiKey(): string {
  const fromEnv = typeof import.meta !== "undefined"
    ? String(import.meta.env?.VITE_PREDICT_FUN_API_KEY ?? "").trim()
    : "";
  return fromEnv;
}

function unwrapRelayResponse<T>(text: string): T {
  const trimmed = text.trim();
  if (!trimmed)
    throw new Error("Predict.fun API 无响应");
  if (trimmed.startsWith("{") || trimmed.startsWith("["))
    return parseJsonLoose(trimmed) as T;
  return trimmed as T;
}

async function predictFunRelayGet<T>(
  url: string,
  headers?: Record<string, string>,
): Promise<T> {
  const res = await changmenRelayHttpRequest(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "x-proxy-referer": PREDICT_FUN_RELAY_ORIGIN,
      "x-proxy-origin": "https://predict.fun",
      ...(headers || {}),
    },
  });
  if (res.status >= 400)
    throw new Error(res.text?.trim() || `HTTP ${res.status}`);
  return unwrapRelayResponse<T>(res.text);
}

async function predictFunDirectGet<T>(
  url: string,
  headers?: Record<string, string>,
): Promise<T> {
  return directGet<T>(url, {
    Accept: "application/json",
    ...(headers || {}),
  });
}

/** Predict.fun REST GET（direct | vps） */
export async function predictFunHttpGet<T>(
  url: string,
  headers?: Record<string, string>,
): Promise<T> {
  if (resolvePfHttpMode() === "direct")
    return predictFunDirectGet<T>(url, headers);
  return predictFunRelayGet<T>(url, headers);
}

async function predictFunRelayPost<T>(
  url: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  const res = await changmenRelayHttpRequest(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-proxy-referer": PREDICT_FUN_RELAY_ORIGIN,
      "x-proxy-origin": "https://predict.fun",
      ...(headers || {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status >= 400)
    throw new Error(res.text?.trim() || `HTTP ${res.status}`);
  return unwrapRelayResponse<T>(res.text);
}

async function predictFunDirectPost<T>(
  url: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  return directPostJson<T>(url, {
    Accept: "application/json",
    ...(headers || {}),
  }, body);
}

/** Predict.fun REST POST（direct | vps） */
export async function predictFunHttpPost<T>(
  url: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  if (resolvePfHttpMode() === "direct")
    return predictFunDirectPost<T>(url, body, headers);
  return predictFunRelayPost<T>(url, body, headers);
}

export function isPredictFunHttpTransportReady(): boolean {
  return true;
}
