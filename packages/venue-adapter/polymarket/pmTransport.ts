import { sharePublicGet, withPublicRoute } from "./pmPublicRoute";
/**
 * Polymarket HTTP 统一出口：按 pmTransportMode 分流 official / VPS / 插件。
 * 业务代码只依赖 transport.ts / pmClientApi.ts，不感知 mode。
 */
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { a8PluginDelete, a8PluginGet, a8PluginPost } from "@changmen/client-core/chrome-plugin/bridge";
import { directDeleteJson, directGet, directPostJson } from "@changmen/client-core/shared/http";
import {
  changmenPmEsportCall,
  changmenPmHttpRequest,
  parseJsonLoose,
} from "@changmen/client-core/shared/platformHttp";
import { POLYMARKET_CLOB_API } from "./api";
import { buildL2HeadersFromAccount } from "./l2Auth";
import { measurePmExecution, recordPmExecutionMetric } from "./pmExecutionMetrics";
import { getPmMarketWsSourceMode } from "./pmMarketWsMode";
import { demotePmHttpToVpsFromLocalNetworkError, resolvePmHttpMode } from "./pmTransportMode";

/** vps 模式下公开 /book 直连试探上限；≤0 则不试直连、仍走 VPS。 */
export const PM_GET_BOOK_DIRECT_TIMEOUT_MS = 800;
export const PM_PRIVATE_READ_DIRECT_TIMEOUT_MS = 1_500;
/**
 * POST /order 只等 HTTP ACK，不是官方 delayed 窗。
 * 官方：回包即 matched/delayed；itode 同步 +250ms；体育 delayed 立刻返回，撮合按市场 `sd`。
 * 本值覆盖 VPS `/time`≤8s + CLOB ACK（尖峰数秒）+ 一跳；须大于 VPS POST abort（20s）。
 * 勿对齐 PF 60s（那是签名+中继+RDS）。
 */
export const PM_SUBMIT_ORDER_TIMEOUT_MS = 30_000;

let getBookDirectTimeoutMs = PM_GET_BOOK_DIRECT_TIMEOUT_MS;

export function setPmGetBookDirectTimeoutMsForTests(ms: number): void {
  getBookDirectTimeoutMs = ms;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0)
    return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error(`timeout of ${timeoutMs}ms exceeded`), { code: "ECONNABORTED" }));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

const POLY_HEADER_NAMES = [
  "POLY_ADDRESS",
  "POLY_SIGNATURE",
  "POLY_TIMESTAMP",
  // L1 create/derive api-key requests require the nonce emitted by
  // createL1Headers. L2 requests do not use it, but it must survive the
  // browser -> VPS proxy boundary for credential generation.
  "POLY_NONCE",
  "POLY_API_KEY",
  "POLY_PASSPHRASE",
] as const;

export interface PmTransportHttpOptions {
  headers?: Record<string, string>;
  account?: PlatformAccount;
  l2Path?: string;
}

type PmHttpMethod = "GET" | "POST" | "DELETE";

function pickPolyHeaders(headers?: Record<string, string>): Record<string, string> | undefined {
  if (!headers)
    return undefined;
  const out: Record<string, string> = {};
  for (const name of POLY_HEADER_NAMES) {
    const value = headers[name] ?? headers[name.toLowerCase()];
    if (value != null && String(value).trim())
      out[name] = String(value);
  }
  return Object.keys(out).length ? out : undefined;
}

function unwrapJsonBody<T>(text: string): T {
  const trimmed = text.trim();
  if (!trimmed)
    throw new Error("Polymarket API 无响应");
  if (trimmed.startsWith("{") || trimmed.startsWith("["))
    return parseJsonLoose(trimmed) as T;
  return trimmed as T;
}

async function resolveAuthHeaders(
  method: PmHttpMethod,
  l2Path: string | undefined,
  account: PlatformAccount | undefined,
  polyFromOptions: Record<string, string> | undefined,
  bodyText = "",
): Promise<Record<string, string>> {
  if (polyFromOptions)
    return { ...polyFromOptions };
  if (account && l2Path) {
    const built = await buildL2HeadersFromAccount(account, method, l2Path, bodyText);
    if (built)
      return built;
  }
  return {};
}

function pluginErrorCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err)
    return String((err as { code?: unknown }).code ?? "");
  return "";
}

function pluginErrorMessage(err: unknown): string {
  if (err instanceof Error)
    return err.message;
  if (err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string")
    return String((err as { message: string }).message);
  return typeof err === "string" ? err : "";
}

/** 本机 REST 没出门：Axios Network Error、扩展断连、超时。不含 CLOB FOK 文案。 */
function isPmTransportNetworkError(err: unknown): boolean {
  if (err == null)
    return false;
  if (typeof err === "object" && Number((err as { response?: { status?: number } }).response?.status) >= 400) return false;
  const code = pluginErrorCode(err);
  if (
    code === "ERR_NETWORK"
    || code === "ERR_INTERNET_DISCONNECTED"
    || code === "ECONNABORTED"
    || code === "ECONNRESET"
    || code === "ETIMEDOUT"
  ) {
    return true;
  }
  const msg = pluginErrorMessage(err);
  if (!msg)
    return false;
  return /network error/i.test(msg)
    || /ERR_NETWORK/i.test(msg)
    || /failed to fetch/i.test(msg)
    || /timeout of \d+ms exceeded/i.test(msg)
    || /Gamebet 扩展/i.test(msg)
    || /Could not establish connection/i.test(msg)
    || /Receiving end does not exist/i.test(msg)
    || /Extension context invalidated/i.test(msg);
}

function rethrowAfterLocalNetworkDemote(err: unknown): never {
  if (isPmTransportNetworkError(err)) {
    if (demotePmHttpToVpsFromLocalNetworkError())
      console.warn("[PM transport] 本机 REST Network Error，HTTP 降回 vps");
  }
  throw err;
}

async function pmHttpViaDirect<T>(
  method: PmHttpMethod,
  url: string,
  data: unknown | undefined,
  options?: PmTransportHttpOptions,
): Promise<T> {
  const l2Path = options?.l2Path;
  const bodyText = (method === "POST" || method === "DELETE") && data !== undefined
    ? JSON.stringify(data)
    : "";
  const headers = await resolveAuthHeaders(
    method,
    l2Path,
    options?.account,
    pickPolyHeaders(options?.headers),
    bodyText,
  );
  try {
    if (method === "GET")
      return await directGet<T>(url, headers);
    if (method === "DELETE")
      return await directDeleteJson<T>(url, headers, data);
    return await directPostJson<T>(url, headers, data);
  }
  catch (err) {
    rethrowAfterLocalNetworkDemote(err);
  }
}

async function pmHttpViaExtension<T>(
  method: PmHttpMethod,
  url: string,
  data: unknown | undefined,
  options?: PmTransportHttpOptions,
): Promise<T> {
  const l2Path = options?.l2Path;
  const bodyText = (method === "POST" || method === "DELETE") && data !== undefined
    ? JSON.stringify(data)
    : "";
  const headers = await resolveAuthHeaders(
    method,
    l2Path,
    options?.account,
    pickPolyHeaders(options?.headers),
    bodyText,
  );
  const reqOptions = Object.keys(headers).length ? { headers } : undefined;
  try {
    const raw = method === "GET"
      ? await a8PluginGet(url, reqOptions)
      : method === "DELETE"
        ? await a8PluginDelete(url, data, reqOptions)
        : await a8PluginPost(url, data, reqOptions);
    // 插件 catch 后 resolve(err)，不是 reject；AxiosError 经 sendMessage 会丢掉 instanceof
    if (isPmTransportNetworkError(raw)) {
      const msg = pluginErrorMessage(raw) || "Network Error";
      throw raw instanceof Error ? raw : new Error(msg);
    }
    return unwrapPluginResponse<T>(raw);
  }
  catch (err) {
    rethrowAfterLocalNetworkDemote(err);
  }
}

/** 对齐 PB transport：插件 background 返回 axios response（含 .data） */
function unwrapPluginResponse<T>(response: unknown): T {
  if (response instanceof Error)
    throw response;
  if (response && typeof response === "object") {
    const row = response as Record<string, unknown>;
    // Extension errors may be resolved as serialized Axios errors/responses.
    const upstream = row.response && typeof row.response === "object"
      ? row.response as Record<string, unknown>
      : row;
    if (Number(upstream.status) >= 400) {
      throw Object.assign(new Error(pluginErrorMessage(row) || `HTTP ${upstream.status}`), {
        response: { status: upstream.status, headers: upstream.headers, data: upstream.data },
      });
    }
    if (typeof row.message === "string" && row.response == null && row.status == null && !("data" in row))
      throw new Error(row.message);
    if ("data" in row && ("status" in row || "headers" in row || "statusText" in row))
      return row.data as T;
  }
  return response as T;
}

async function pmHttpViaVps<T>(
  method: PmHttpMethod,
  url: string,
  data: unknown | undefined,
  options?: PmTransportHttpOptions,
): Promise<T> {
  const polyHeaders = pickPolyHeaders(options?.headers);
  const res = await changmenPmHttpRequest({
    method,
    url,
    body: data,
    playerId: options?.account?.accountId && options?.l2Path
      ? Number(options.account.accountId)
      : undefined,
    l2Path: options?.l2Path,
    polyHeaders,
  });
  return unwrapJsonBody<T>(res.text);
}

function dispatchHttp<T>(
  method: PmHttpMethod,
  url: string,
  data: unknown | undefined,
  options?: PmTransportHttpOptions,
): Promise<T> {
  const mode = resolvePmHttpMode();
  if (mode === "direct")
    return pmHttpViaDirect<T>(method, url, data, options);
  if (mode === "extension")
    return pmHttpViaExtension<T>(method, url, data, options);
  if (shouldDirectFirstL2Get(method, options) || shouldDirectFirstPublicGet(method, url, options))
    return pmL2GetDirectFirst<T>(url, options);
  return pmHttpViaVps<T>(method, url, data, options);
}

/** 原 polymarketPluginGet / polymarketPluginPost 底层 */
export async function pmTransportHttpGet<T>(
  url: string,
  options?: PmTransportHttpOptions,
): Promise<T> {
  if (options?.account || options?.l2Path || options?.headers) return dispatchHttp<T>("GET", url, undefined, options);
  const key = JSON.stringify([resolvePmHttpMode(), getPmMarketWsSourceMode(), url]);
  return sharePublicGet(key, () => dispatchHttp<T>("GET", url, undefined, options));
}

export async function pmTransportHttpPost<T>(
  url: string,
  data: unknown,
  options?: PmTransportHttpOptions,
): Promise<T> {
  return dispatchHttp<T>("POST", url, data, options);
}

export async function pmTransportHttpDelete<T>(
  url: string,
  data: unknown,
  options?: PmTransportHttpOptions,
): Promise<T> {
  return dispatchHttp<T>("DELETE", url, data, options);
}

const ORDER_PATH = "/order";
const TRADES_PATH = "/data/trades";
const ORDER_PATH_PREFIX = "/data/order/";
const HEARTBEAT_PATH = "/v1/heartbeats";
const OPEN_ORDERS_PATH = "/data/orders";
const NO_MORE_CURSOR = "LTE=";

type LocalHttpMode = "direct" | "extension";

function stripEsportBodyForVps(body: Record<string, unknown>): Record<string, unknown> {
  const { _account, ...rest } = body;
  void _account;
  return rest;
}

function requireEsportAccount(body: Record<string, unknown>): PlatformAccount {
  const account = body._account as PlatformAccount | undefined;
  if (!account?.token)
    throw new Error("Polymarket 语义 API 需要账号 token（extension/direct 模式）");
  return account;
}

function clobGatewayFromAccount(account: PlatformAccount): string {
  return String(account.gateway || POLYMARKET_CLOB_API).replace(/\/+$/, "");
}

function parseEsportOrderField(raw: unknown): Record<string, unknown> | undefined {
  if (raw == null || raw === "")
    return undefined;
  if (typeof raw === "object" && !Array.isArray(raw))
    return raw as Record<string, unknown>;
  const text = String(raw).trim();
  if (!text)
    return undefined;
  if (text.startsWith("{") || text.startsWith("["))
    return parseJsonLoose(text) as Record<string, unknown>;
  return undefined;
}

function extractHeartbeatId(raw: unknown): string {
  if (!raw || typeof raw !== "object")
    return "";
  const row = raw as Record<string, unknown>;
  const id = row.heartbeat_id ?? row.heartbeatId;
  return id == null ? "" : String(id);
}

function extractHeartbeatIdFromError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const rawText = err && typeof err === "object" && "rawText" in err
    ? String((err as { rawText?: unknown }).rawText ?? "")
    : "";
  for (const source of [rawText, msg]) {
    if (!source)
      continue;
    const text = String(source);
    const jsonStart = text.indexOf("{");
    if (jsonStart >= 0) {
      try {
        const id = extractHeartbeatId(parseJsonLoose(text.slice(jsonStart)));
        if (id)
          return id;
      }
      catch { /* ignore */ }
    }
  }
  const m = msg.match(/heartbeat_id["']?\s*[:=]\s*["']?([\w-]+)/i);
  return m?.[1] ?? "";
}

async function localHttpGet<T>(
  mode: LocalHttpMode,
  url: string,
  options?: PmTransportHttpOptions,
): Promise<T> {
  if (mode === "direct")
    return pmHttpViaDirect<T>("GET", url, undefined, options);
  return pmHttpViaExtension<T>("GET", url, undefined, options);
}

async function localHttpPost<T>(
  mode: LocalHttpMode,
  url: string,
  data: unknown,
  options?: PmTransportHttpOptions,
): Promise<T> {
  if (mode === "direct")
    return pmHttpViaDirect<T>("POST", url, data, options);
  return pmHttpViaExtension<T>("POST", url, data, options);
}

async function localHttpDelete<T>(
  mode: LocalHttpMode,
  url: string,
  data: unknown,
  options?: PmTransportHttpOptions,
): Promise<T> {
  if (mode === "direct")
    return pmHttpViaDirect<T>("DELETE", url, data, options);
  return pmHttpViaExtension<T>("DELETE", url, data, options);
}

async function fetchPolymarketTradesSinceLocal(
  mode: LocalHttpMode,
  account: PlatformAccount,
  gateway: string,
  afterSec: number,
  maxPages: number,
): Promise<unknown[]> {
  const host = String(gateway || POLYMARKET_CLOB_API).replace(/\/+$/, "");
  const all: unknown[] = [];
  let nextCursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({ after: String(Math.floor(afterSec)) });
    if (nextCursor)
      params.set("next_cursor", nextCursor);
    const url = `${host}${TRADES_PATH}?${params.toString()}`;
    const data = await localHttpGet<{ data?: unknown[]; next_cursor?: string }>(
      mode,
      url,
      { account, l2Path: TRADES_PATH },
    );
    const batch = Array.isArray(data?.data) ? data.data : [];
    all.push(...batch);
    nextCursor = data?.next_cursor;
    if (!nextCursor || nextCursor === NO_MORE_CURSOR || batch.length === 0)
      break;
  }
  return all;
}

/** 官方 getTrades({ id }, onlyFirstPage)：单页按 tradeID 查 */
async function fetchPolymarketTradesByIdLocal(
  mode: LocalHttpMode,
  account: PlatformAccount,
  gateway: string,
  tradeId: string,
): Promise<unknown[]> {
  const host = String(gateway || POLYMARKET_CLOB_API).replace(/\/+$/, "");
  const params = new URLSearchParams({ id: String(tradeId).trim() });
  const url = `${host}${TRADES_PATH}?${params.toString()}`;
  const data = await localHttpGet<{ data?: unknown[] }>(
    mode,
    url,
    { account, l2Path: TRADES_PATH },
  );
  return Array.isArray(data?.data) ? data.data : [];
}

async function pmEsportCallLocal<T>(
  mode: LocalHttpMode,
  action: string,
  body: Record<string, unknown>,
): Promise<T> {
  switch (action) {
    case "Pm_GetBook": {
      const tokenId = String(body.tokenId ?? "").trim();
      if (!tokenId)
        throw new Error("tokenId 必填");
      const gateway = String(body.gateway || POLYMARKET_CLOB_API).replace(/\/+$/, "");
      const params = new URLSearchParams({ token_id: tokenId });
      return localHttpGet<T>(mode, `${gateway}/book?${params.toString()}`);
    }
    case "Pm_SubmitOrder": {
      const account = requireEsportAccount(body);
      const order = parseEsportOrderField(body.order);
      if (!order)
        throw new Error("order 必填");
      const gateway = clobGatewayFromAccount(account);
      return localHttpPost<T>(mode, `${gateway}${ORDER_PATH}`, order, {
        account,
        l2Path: ORDER_PATH,
      });
    }
    case "Pm_CancelOrder": {
      const account = requireEsportAccount(body);
      const orderId = String(body.orderId ?? body.orderID ?? "").trim();
      if (!orderId)
        throw new Error("orderId 必填");
      const gateway = clobGatewayFromAccount(account);
      return localHttpDelete<T>(mode, `${gateway}${ORDER_PATH}`, { orderID: orderId }, {
        account,
        l2Path: ORDER_PATH,
      });
    }
    case "Pm_GetTrades": {
      const account = requireEsportAccount(body);
      const tradeId = String(body.id ?? body.tradeId ?? body.tradeID ?? "").trim();
      if (tradeId) {
        return fetchPolymarketTradesByIdLocal(
          mode,
          account,
          clobGatewayFromAccount(account),
          tradeId,
        ) as Promise<T>;
      }
      const afterSec = Number(body.after);
      if (!Number.isFinite(afterSec) || afterSec <= 0)
        throw new Error("after 或 id 必填");
      const maxPages = Math.min(Math.max(Number(body.maxPages) || 30, 1), 30);
      return fetchPolymarketTradesSinceLocal(
        mode,
        account,
        clobGatewayFromAccount(account),
        Math.floor(afterSec),
        maxPages,
      ) as Promise<T>;
    }
    case "Pm_GetOrder": {
      const account = requireEsportAccount(body);
      const orderId = String(body.orderId ?? "").trim();
      if (!orderId)
        throw new Error("orderId 必填");
      const gateway = clobGatewayFromAccount(account);
      const path = `${ORDER_PATH_PREFIX}${orderId}`;
      return localHttpGet<T>(mode, `${gateway}${path}`, { account, l2Path: path });
    }
    case "Pm_Heartbeat": {
      const account = requireEsportAccount(body);
      const gateway = clobGatewayFromAccount(account);
      const heartbeatId = String(body.heartbeatId ?? body.heartbeat_id ?? "").trim();

      async function postOnce(id: string) {
        const payload = { heartbeat_id: id };
        return localHttpPost<Record<string, unknown>>(
          mode,
          `${gateway}${HEARTBEAT_PATH}`,
          payload,
          { account, l2Path: HEARTBEAT_PATH },
        );
      }

      try {
        const res = await postOnce(heartbeatId);
        const nextId = extractHeartbeatId(res) || heartbeatId;
        return { heartbeat_id: nextId } as T;
      }
      catch (err) {
        const recovered = extractHeartbeatIdFromError(err);
        if (!recovered)
          throw err;
        const res = await postOnce(recovered);
        const nextId = extractHeartbeatId(res) || recovered;
        return { heartbeat_id: nextId } as T;
      }
    }
    case "Pm_GetOpenOrders": {
      const account = requireEsportAccount(body);
      const gateway = clobGatewayFromAccount(account);
      const assetId = String(body.assetId ?? body.tokenId ?? "").trim();
      const qs = new URLSearchParams();
      if (assetId)
        qs.set("asset_id", assetId);
      if (body.id)
        qs.set("id", String(body.id));
      const l2Path = qs.toString() ? `${OPEN_ORDERS_PATH}?${qs.toString()}` : OPEN_ORDERS_PATH;
      return localHttpGet<T>(mode, `${gateway}${l2Path}`, { account, l2Path: OPEN_ORDERS_PATH });
    }
    default:
      throw new Error(
        `[PmTransport] ${mode} 模式尚未实现 ${action}，请设 PM_HTTP_MODE=vps 或补全 pmEsportCallLocal`,
      );
  }
}

async function pmEsportCallDirect<T>(
  action: string,
  body: Record<string, unknown>,
): Promise<T> {
  return pmEsportCallLocal<T>("direct", action, body);
}

async function pmEsportCallExtension<T>(
  action: string,
  body: Record<string, unknown>,
): Promise<T> {
  return pmEsportCallLocal<T>("extension", action, body);
}

function isPmPluginDisconnectError(err: unknown): boolean {
  const msg = pluginErrorMessage(err);
  return /Could not establish connection/i.test(msg)
    || /Receiving end does not exist/i.test(msg)
    || /Extension context invalidated/i.test(msg);
}

function vpsEsportOpts(action: string): { timeoutMs: number } | undefined {
  return action === "Pm_SubmitOrder" ? { timeoutMs: PM_SUBMIT_ORDER_TIMEOUT_MS } : undefined;
}

const PRIVATE_READ_DIRECT_FIRST_ACTIONS = new Set([
  "Pm_GetTrades",
  "Pm_GetOrder",
  "Pm_GetOpenOrders",
  "Pm_Heartbeat",
]);

function shouldDirectFirstPrivateRead(action: string): boolean {
  return PRIVATE_READ_DIRECT_FIRST_ACTIONS.has(action)
    && resolvePmHttpMode() === "vps"
    && getPmMarketWsSourceMode() === "official";
}

function shouldDirectFirstL2Get(
  method: PmHttpMethod,
  options?: PmTransportHttpOptions,
): boolean {
  return method === "GET"
    && resolvePmHttpMode() === "vps"
    && getPmMarketWsSourceMode() === "official"
    && Boolean(options?.account && options?.l2Path);
}

function shouldDirectFirstPublicGet(
  method: PmHttpMethod,
  url: string,
  options?: PmTransportHttpOptions,
): boolean {
  if (method !== "GET" || resolvePmHttpMode() !== "vps"
    || getPmMarketWsSourceMode() !== "official" || options?.account || options?.l2Path) {
    return false;
  }
  try {
    const target = new URL(url);
    return target.protocol === "https:"
      && ["data-api.polymarket.com", "gamma-api.polymarket.com", "clob.polymarket.com"].includes(target.hostname);
  }
  catch {
    return false;
  }
}

async function pmL2GetDirectFirst<T>(
  url: string,
  options?: PmTransportHttpOptions,
): Promise<T> {
  if (shouldDirectFirstPublicGet("GET", url, options)) {
    return withPublicRoute(url,
      () => withTimeout(pmHttpViaDirect<T>("GET", url, undefined, options), PM_PRIVATE_READ_DIRECT_TIMEOUT_MS),
      () => pmHttpViaVps<T>("GET", url, undefined, options), isPmTransportNetworkError);
  }
  try {
    return await withTimeout(
      pmHttpViaDirect<T>("GET", url, undefined, options),
      PM_PRIVATE_READ_DIRECT_TIMEOUT_MS,
    );
  }
  catch (error) {
    if (!isPmTransportNetworkError(error))
      throw error;
    return pmHttpViaVps<T>("GET", url, undefined, options);
  }
}

async function pmPrivateReadDirectFirst<T>(
  action: string,
  body: Record<string, unknown>,
): Promise<T> {
  try {
    return await withTimeout(
      pmEsportCallDirect<T>(action, body),
      PM_PRIVATE_READ_DIRECT_TIMEOUT_MS,
    );
  }
  catch (error) {
    if (!isPmTransportNetworkError(error))
      throw error;
    return changmenPmEsportCall<T>(action, stripEsportBodyForVps(body));
  }
}

/**
 * pmClientApi 底层：按 mode 走 VPS 语义 API / 直连 / 插件。
 * 官网模式的读取优先直连，网络失败/超时回落 VPS；relay 模式固定 VPS。
 * 官方 PM-M 用户：公开/私有读取 direct-first；交易写入仍走 VPS。
 * Pm_SubmitOrder：HTTP 只等 POST ACK（30s）；插件断连同一次回落 VPS。timeout 不重试 POST。
 * 官方 delayed 撮合不占这个窗，见 marketDelay `sd`。
 */
export async function pmEsportCall<T>(
  action: string,
  body: Record<string, unknown>,
): Promise<T> {
  if (action === "Pm_GetBook")
    return sharePublicGet(JSON.stringify(["book", resolvePmHttpMode(), getPmMarketWsSourceMode(), body.gateway, body.tokenId]), () => pmGetBookPreferDirect<T>(body));
  if (action === "Pm_PrepareSubmit") return changmenPmEsportCall<T>(action, stripEsportBodyForVps(body));
  if (shouldDirectFirstPrivateRead(action))
    return pmPrivateReadDirectFirst<T>(action, body);
  const mode = resolvePmHttpMode();
  if (mode === "vps") {
    const opts = vpsEsportOpts(action);
    return opts
      ? changmenPmEsportCall<T>(action, stripEsportBodyForVps(body), opts)
      : changmenPmEsportCall<T>(action, stripEsportBodyForVps(body));
  }
  if (mode === "direct")
    return pmEsportCallDirect<T>(action, body);
  try {
    return await pmEsportCallExtension<T>(action, body);
  }
  catch (err) {
    if (action === "Pm_SubmitOrder" && isPmPluginDisconnectError(err)) {
      return changmenPmEsportCall<T>(
        action,
        { ...stripEsportBodyForVps(body), clientL2Timestamp: Math.floor(Date.now() / 1_000) },
        { timeoutMs: PM_SUBMIT_ORDER_TIMEOUT_MS },
      );
    }
    throw err;
  }
}

async function pmGetBookPreferDirect<T>(body: Record<string, unknown>): Promise<T> {
  const mode = resolvePmHttpMode();
  const tokenId = String(body.tokenId ?? "").trim() || undefined;
  if (mode === "extension") {
    return measurePmExecution("book", { tokenId, bookSource: "extension" }, () =>
      pmEsportCallExtension<T>("Pm_GetBook", body));
  }
  const timeoutMs = mode === "vps" && getPmMarketWsSourceMode() === "official"
    ? getBookDirectTimeoutMs
    : 0;
  if (mode === "vps" && timeoutMs <= 0) {
    return measurePmExecution("book", { tokenId, bookSource: "vps-live" }, () =>
      changmenPmEsportCall<T>("Pm_GetBook", stripEsportBodyForVps(body)));
  }
  if (mode === "vps") {
    let fallback = false;
    let directMs = 0; let fallbackMs = 0; let requestCount = 0;
    const started = performance.now();
    try {
      const result = await withPublicRoute(String(body.gateway || POLYMARKET_CLOB_API),
        async () => {
          requestCount++; const at = performance.now();
          try { return await withTimeout(pmEsportCallDirect<T>("Pm_GetBook", body), timeoutMs); }
          finally { directMs = performance.now() - at; }
        },
        async () => {
          fallback = true; requestCount++; const at = performance.now();
          try { return await changmenPmEsportCall<T>("Pm_GetBook", stripEsportBodyForVps(body)); }
          finally { fallbackMs = performance.now() - at; }
        },
        isPmTransportNetworkError);
      recordPmExecutionMetric({ kind: "book", tokenId, directMs, fallbackMs, requestCount, ms: performance.now() - started,
        bookSource: fallback ? "vps-fallback" : "direct-live", fallback, success: true });
      return result;
    } catch (err) {
      recordPmExecutionMetric({ kind: "book", tokenId, directMs, fallbackMs, requestCount, ms: performance.now() - started,
        bookSource: fallback ? "vps-fallback" : "direct-live", fallback, success: false, error: String(err) });
      throw err;
    }
  }
  try {
    const startedAt = Date.now();
    const direct = pmEsportCallDirect<T>("Pm_GetBook", body);
    const value = await (timeoutMs > 0 ? withTimeout(direct, timeoutMs) : direct);
    recordPmExecutionMetric({
      kind: "book",
      tokenId,
      bookSource: "direct-live",
      ms: Date.now() - startedAt,
      success: true,
      fallback: false,
    });
    return value;
  }
  catch (err) {
    if (isPmTransportNetworkError(err)) {
      if (mode === "direct")
        demotePmHttpToVpsFromLocalNetworkError();
      return measurePmExecution("book", {
        tokenId,
        bookSource: "vps-fallback",
        fallback: true,
      }, () => changmenPmEsportCall<T>("Pm_GetBook", stripEsportBodyForVps(body)));
    }
    recordPmExecutionMetric({
      kind: "book",
      tokenId,
      bookSource: "direct-live",
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
