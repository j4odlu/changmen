import type { EsportAction } from "@changmen/api-contract/actions";
import {
  GetCollectPlatformRequest,
  GetGamesRequest,
  LoginRequest,
  RefreshTokenRequest,
  SaveBetRequest,
  SaveMatchRequest,
  SaveLiveTimerRequest,
  UpdatePlatformRequest,
  warnClientGetMatchsOutbound,
  getGetMatchsOutboundWarnStats,
} from "@changmen/api-contract/schemas";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as sb from "@changmen/db";
import catalog from "@changmen/shared/catalog/game_catalog.json" with { type: "json" };
import venueGames from "@changmen/shared/catalog/venue_games.json" with { type: "json" };
import { getDefaultMarketCode, getPlatformRules } from "@changmen/shared/catalog/market_catalog";
import { isWsForwardHttpPath } from "@changmen/ws-forward";
import * as accountStore from "../account/account_store.js";
import { assertProfileActive } from "../account/admin_service.js";
import { normalizeClientIp, recordUserLastLogin } from "../account/user_login_meta.js";
import { touchUserPresence } from "../account/user_presence.js";
import { checkActionAuth, PUBLIC_ACTIONS } from "../auth/action_permissions.js";
import { resolveRequestAuth, shouldAuditAccessFailure } from "../auth/request_auth.js";
import { isAdminUser } from "../auth/admin_auth.js";
import {
  browserSessionEnabled,
  clearBrowserSessionCookie,
  readBrowserSessionCookie,
  setBrowserSessionCookie,
} from "../auth/browser_session.js";
import {
  checkLoginRateLimit,
  recordLoginFailure,
  recordLoginSuccess,
} from "../auth/login_rate_limit.js";
import * as dbStore from "../db/store.js";
import { resolveA8Credentials } from "../integrations/a8/config.js";
import { requirePlatform } from "../shared/adapter_paths.js";
import { handleAccountClientAction, isAccountClientAction } from "./account_client_routes.js";
import { handleAdminAction, isAdminAction } from "./admin_routes.js";
import { handleFootballOrderAction, isFootballOrderAction } from "./football_order_routes.js";
import { handleCommonApi } from "./hg_follow.js";
import { handlePmPfAction, isPmPfAction } from "./pm_pf_routes.js";
import {
  compareActionRoute,
  getActionDispatchMode,
  getActionRoute,
  legacyBucketFor,
  type ActionBucket,
} from "./action_registry.js";
import { resolveMarketHubOriginForUser } from "./market_hub_route.js";
import store from "./store.js";
import { filterMarketIndexByClientMatches } from "./filter_market_index_by_matches.js";
import { handleSendMessage as sendTelegramMessage } from "./telegram_send.js";
import { handleClientNotifyAdminTelegram } from "../admin_tools/client_mirror_notify.js";
import { handleV4Request } from "./v4_router.js";
import { recordEsportRequest } from "../shared/esport_request_timing.js";
import { certLoginBindError, clientCertCnFromSubject, readClientCertStatus } from "../shared/client_cert_gate.js";

/** 磁盘全量 Index ∩ client_matches；空合场 → 空 Index（不 fail-open） */
async function attachFilteredVpsMarketIndex(provider: string, target: Record<string, unknown>) {
  if (provider !== "Polymarket" && provider !== "PredictFun" && provider !== "SXBet")
    return;
  const matches = await dbStore.loadClientMatchesFromDb();
  const rows = Array.isArray(matches) ? matches : [];
  if (provider === "Polymarket") {
    const { readPolymarketMarketIndex } = await import("@changmen/storage/polymarket_market_index.js");
    target.MarketIndex = filterMarketIndexByClientMatches("Polymarket", readPolymarketMarketIndex(), rows);
    return;
  }
  if (provider === "PredictFun") {
    const { readPredictFunMarketIndex } = await import("@changmen/storage/predictfun_market_index.js");
    target.MarketIndex = filterMarketIndexByClientMatches("PredictFun", readPredictFunMarketIndex(), rows);
    return;
  }
  const { readSxBetMarketIndex } = await import("@changmen/storage/sxbet_market_index.js");
  target.MarketIndex = filterMarketIndexByClientMatches("SXBet", readSxBetMarketIndex(), rows);
}

export type { EsportAction } from "@changmen/api-contract/actions";

// ?? Types ????????????????????????????????????????????????????????????????????

export interface ApiSuccess<T = unknown> {
  success: 1;
  msg: string;
  info: T | null;
}

export interface ApiFailure {
  success: 0;
  code?: string;
  msg: string;
  info: null;
}

export type ApiEnvelope<T = unknown> = ApiSuccess<T> | ApiFailure;

export interface EsportUser {
  id: string;
  userName: string;
  isAdmin?: boolean;
  role?: string;
  teamId?: string | null;
  setting?: Record<string, unknown>;
}

interface EsportContext {
  token: string;
  user: EsportUser | null;
  audit?: AuthAuditContext;
  browserSessionToken?: string;
  response?: ServerResponse;
}

interface AuthAuditContext {
  clientIp?: string;
  certCn?: string;
  userAgent?: string;
}

function requireActionAuth(
  action: EsportAction | string,
  ctx: EsportContext,
): ApiFailure | null {
  const result = checkActionAuth(action, ctx.user);
  return result as ApiFailure | null;
}

// ?? Helpers ??????????????????????????????????????????????????????????????????

function ok<T>(info: T, msg = "ok"): ApiSuccess<T> {
  return { success: 1, msg, info: info ?? null };
}

function fail(msg: string, info = null, code?: string): ApiFailure {
  return { success: 0, ...(code ? { code } : {}), msg, info };
}

function getJwtClaim(token: string, claim: string): unknown {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString())[claim];
  }
  catch {
    return null;
  }
}

function authNotConfiguredMessage(): string {
  return "未配置 JWT：请在 server/backend/.env 设置 JWT_SECRET，并配置 DATABASE_URL";
}

function profileLoadFailMessage(): string {
  return "加载用户失败，请检查 RDS profiles 连接";
}

export function resolveCreditPlateUserName(user: EsportUser | null): string {
  const fromSetting = user?.setting?.a8UserName;
  if (fromSetting && String(fromSetting).trim()) {
    return String(fromSetting).trim();
  }
  const name = user?.userName && String(user.userName).trim();
  if (name && name !== "admin") {
    return name;
  }
  return resolveA8Credentials().userName;
}

function parseFormBody(raw: string): Record<string, string> {
  const params = new URLSearchParams(raw);
  const out: Record<string, string> = {};
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk;
      if (raw.length > 5e6) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

async function parseRequest(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  const ct = String(req.headers["content-type"] || "");
  if (ct.includes("application/x-www-form-urlencoded"))
    return parseFormBody(raw);
  if (ct.includes("application/json")) {
    try { return raw ? JSON.parse(raw) : {}; }
    catch { return {}; }
  }
  if (raw.includes("="))
    return parseFormBody(raw);
  return raw ? { _raw: raw } : {};
}

function actionFromUrl(urlPath: string): string {
  const base = urlPath.replace(/^\/esport\/?/, "").split("?")[0];
  return base.replace(/^\//, "");
}

function gamesForProvider(provider: string): string[] {
  const fromVenueGames = (venueGames as { providers?: Record<string, unknown> }).providers?.[provider];
  if (Array.isArray(fromVenueGames))
    return [...new Set(fromVenueGames.filter(Boolean).map(String))];

  const ids = new Set<string>();
  for (const game of catalog.games || []) {
    // 棒球/足球联赛不进 Client_GetGames（与 venue_games 仅电竞一致）
    if (((game as { sport?: string }).sport ?? "esport") !== "esport")
      continue;
    const id = game.platforms?.[provider];
    if (id)
      ids.add(String(id));
  }
  return [...ids];
}

// ?? Action handlers ??????????????????????????????????????????????????????????

function clientIpFromRequest(req?: IncomingMessage): string {
  if (!req)
    return "";
  const raw
    = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
      || req.socket?.remoteAddress
      || "";
  return normalizeClientIp(raw);
}

async function handleClientLogin(
  body: Record<string, unknown>,
  clientIp = "",
  cert?: { hasClientCert: boolean; subject: string } | null,
  userAgent = "",
  response?: ServerResponse,
): Promise<ApiEnvelope> {
  const parsed = LoginRequest.safeParse({ userName: body.userName || body.username, password: body.password });
  if (!parsed.success)
    return fail("用户名或密码不能为空");
  const { userName, password } = parsed.data;
  const rate = checkLoginRateLimit(userName, clientIp);
  if (rate.limited) {
    void sb.recordAuthAudit({
      userName,
      clientIp,
      userAgent,
      eventType: "LOGIN",
      result: "DENIED",
      reasonCode: "RATE_LIMITED",
    });
    return fail(`登录尝试过于频繁，请在 ${rate.retryAfterSec} 秒后重试`, null, "RATE_LIMITED");
  }
  if (!sb.isAuthConfigured()) {
    return fail(authNotConfiguredMessage(), null, "TEMPORARY_UNAVAILABLE");
  }

  const audit = {
    clientIp,
    certCn: clientCertCnFromSubject(cert?.subject),
    userAgent,
  };

  // mTLS 叶子 CN 必须与登录用户名一致（生产默认开启；本机 DEV 默认关）
  // 在验密之前拦截，避免无证/错证时泄露「密码是否正确」
  const bindErr = certLoginBindError(userName, cert ?? null);
  if (bindErr) {
    recordLoginFailure(userName, clientIp);
    void sb.recordAuthAudit({
      ...audit,
      userName,
      eventType: "LOGIN",
      result: "DENIED",
      reasonCode: "CERT_BIND_FAILED",
    });
    return fail(bindErr, null, "CERT_BIND_FAILED");
  }

  const auth = await sb.authSignIn(userName, password, audit);
  if (auth && "error" in auth && auth.error === "db") {
    return fail("数据库连接失败，请检查 DATABASE_URL 配置", null, "TEMPORARY_UNAVAILABLE");
  }
  if (!auth || "error" in auth)
  {
    recordLoginFailure(userName, clientIp);
    return fail("用户名或密码错误", null, "INVALID_CREDENTIALS");
  }

  const { accessToken, browserAccessToken, refreshToken, userId: uid, sessionId, email } = auth;

  let profile = await dbStore.loadProfileById(uid);
  if (!profile) {
    const inferredName = (email as string).split("@")[0];
    const now = Date.now();
    const ok2 = await sb.insertProfile(uid, {
      id: uid,
      user_name: inferredName,
      accounts: [],
      betting_config: {},
      collect_config: {},
      preferences: {},
      created_at: now,
      updated_at: now,
    });
    if (ok2)
      profile = await dbStore.loadProfileById(uid);
  }
  if (!profile)
    return fail(profileLoadFailMessage(), null, "TEMPORARY_UNAVAILABLE");

  // 密码通过后再用 profile 用户名复核一次（防止大小写/别名与 CN 不一致）
  const bindName = String(profile.userName || userName || "").trim();
  const bindErr2 = certLoginBindError(bindName, cert ?? null);
  if (bindErr2)
    return fail(bindErr2, null, "CERT_BIND_FAILED");

  try {
    await assertProfileActive(uid);
  }
  catch (err) {
    return fail((err as Error).message || "账号状态异常，请联系管理员", null, "ACCOUNT_DISABLED");
  }

  touchUserPresence(uid);
  await recordUserLastLogin(uid, clientIp);
  recordLoginSuccess(userName, clientIp);

  let sessionMode = "legacy";
  if (response && browserSessionEnabled()) {
    const browserSession = await sb.createBrowserSession(uid, sessionId, audit);
    if (browserSession) {
      setBrowserSessionCookie(response, browserSession.token, browserSession.absoluteExpiresAt);
      sessionMode = "cookie";
    }
  }

  return ok({
    token: sessionMode === "cookie" ? browserAccessToken : accessToken,
    ...(sessionMode === "legacy" ? { refreshToken } : {}),
    sessionMode,
    userName: profile.userName,
    ID: uid,
  });
}

async function handle(
  action: EsportAction | string,
  body: Record<string, unknown>,
  ctx: EsportContext,
): Promise<ApiEnvelope> {
  const authFailure = requireActionAuth(action, ctx);
  if (authFailure)
    return authFailure;

  if (ctx.user?.id) {
    try {
      await assertProfileActive(ctx.user.id);
    }
    catch (err) {
      return fail((err as Error).message || "账号状态异常，请联系管理员");
    }
    touchUserPresence(ctx.user.id);
  }

  const mode = getActionDispatchMode();
  let legacyBucket: ActionBucket;
  let result: ApiEnvelope;

  if (mode === "registry") {
    legacyBucket = legacyBucketFor(String(action));
    result = await dispatchViaRegistry(String(action), body, ctx);
  }
  else {
    const dispatched = await dispatchLegacy(String(action), body, ctx);
    legacyBucket = dispatched.bucket;
    result = dispatched.result;
  }

  compareActionRoute(String(action), legacyBucket);
  return result;
}

async function dispatchLegacy(
  action: string,
  body: Record<string, unknown>,
  ctx: EsportContext,
): Promise<{ bucket: ActionBucket, result: ApiEnvelope }> {
  if (isAdminAction(action)) {
    if (!ctx.user)
      return { bucket: "admin", result: fail("未登录") };
    const adminResult = await handleAdminAction(action, body, { user: ctx.user });
    return {
      bucket: "admin",
      result: adminResult ?? fail(`未知管理端 action: ${action}`),
    };
  }

  if (isPmPfAction(action)) {
    if (!ctx.user)
      return { bucket: "pm_pf", result: fail("未登录") };
    const pmPfResult = await handlePmPfAction(action, body, { user: ctx.user });
    return {
      bucket: "pm_pf",
      result: pmPfResult ?? fail(`未知预测市场 action: ${action}`),
    };
  }

  if (isFootballOrderAction(action)) {
    const footballResult = await handleFootballOrderAction(action, body, { user: ctx.user });
    return {
      bucket: "core",
      result: footballResult ?? fail(`未知足球订单 action: ${action}`),
    };
  }

  if (isAccountClientAction(action)) {
    const accountResult = await handleAccountClientAction(action, body, { user: ctx.user });
    return {
      bucket: "account",
      result: (accountResult ?? fail(`未知账号端 action: ${action}`)) as ApiEnvelope,
    };
  }

  return {
    bucket: "core",
    result: await handleCoreAction(action as EsportAction, body, ctx),
  };
}

async function dispatchViaRegistry(
  action: string,
  body: Record<string, unknown>,
  ctx: EsportContext,
): Promise<ApiEnvelope> {
  // 未进 contract 表的 action 仍按 live 规则分类，与 legacy 前缀/Set 行为一致
  const route = getActionRoute(action) ?? {
    action,
    bucket: legacyBucketFor(action),
    handlerId: action,
  };

  switch (route.bucket) {
    case "login":
      // 正常路径不会进入：HTTP/IPC 已提前处理 Client_Login。
      // 与 legacy→handleCoreAction default 保持同一文案，避免模式切换出现可观测差异。
      return fail(`unknown action: ${action}`);
    case "admin": {
      if (!ctx.user)
        return fail("未登录");
      const adminResult = await handleAdminAction(action, body, { user: ctx.user });
      return adminResult ?? fail(`未知管理端 action: ${action}`);
    }
    case "pm_pf": {
      if (!ctx.user)
        return fail("未登录");
      const pmPfResult = await handlePmPfAction(action, body, { user: ctx.user });
      return pmPfResult ?? fail(`未知预测市场 action: ${action}`);
    }
    case "account": {
      const accountResult = await handleAccountClientAction(action, body, { user: ctx.user });
      return (accountResult ?? fail(`未知账号端 action: ${action}`)) as ApiEnvelope;
    }
    case "core":
      if (isFootballOrderAction(action)) {
        const footballResult = await handleFootballOrderAction(action, body, { user: ctx.user });
        return footballResult ?? fail(`未知足球订单 action: ${action}`);
      }
      return handleCoreAction(action as EsportAction, body, ctx);
    default:
      return fail(`unknown action: ${action}`);
  }
}

async function handleCoreAction(
  action: EsportAction | string,
  body: Record<string, unknown>,
  ctx: EsportContext,
): Promise<ApiEnvelope> {
  switch (action as EsportAction) {
    case "Client_Logout": {
      await sb.authSignOut(ctx.token, ctx.audit);
      if (ctx.browserSessionToken)
        await sb.revokeBrowserSession(ctx.browserSessionToken, "LOGOUT");
      if (ctx.response)
        clearBrowserSessionCookie(ctx.response);
      return ok(null);
    }
    case "Client_RefreshToken": {
      const rtParsed = RefreshTokenRequest.safeParse(body);
      const refreshToken = rtParsed.success
        ? rtParsed.data.refreshToken || rtParsed.data.refresh_token
        : "";
      const auth = refreshToken
        ? await sb.authRefreshToken(String(refreshToken), ctx.audit)
        : ctx.browserSessionToken
          ? await sb.authBrowserSession(ctx.browserSessionToken, ctx.audit)
          : { invalid: true };
      if (auth && "revoked" in auth && auth.revoked) {
        return fail("会话已失效，请重新登录", null, "SESSION_REVOKED");
      }
      if (auth && "invalid" in auth && auth.invalid)
        return fail("刷新 token 已过期，请重新登录", null, "REFRESH_TOKEN_EXPIRED");
      if (auth && "temporary" in auth && auth.temporary)
        return fail("登录服务暂时不可用，请稍后重试", null, "TEMPORARY_UNAVAILABLE");
      if (!auth || !("accessToken" in auth))
        return fail("刷新 token 失败", null, "TEMPORARY_UNAVAILABLE");
      try {
        await assertProfileActive(auth.userId);
      }
      catch (err) {
        return fail((err as Error).message || "账号状态异常，请联系管理员", null, "ACCOUNT_DISABLED");
      }
      touchUserPresence(auth.userId);
      let sessionMode = ctx.browserSessionToken ? "cookie" : "legacy";
      if (!ctx.browserSessionToken && ctx.response && browserSessionEnabled() && "sessionId" in auth) {
        const browserSession = await sb.createBrowserSession(auth.userId, auth.sessionId, ctx.audit);
        if (browserSession) {
          setBrowserSessionCookie(ctx.response, browserSession.token, browserSession.absoluteExpiresAt);
          sessionMode = "cookie";
        }
      }
      return ok({
        token: sessionMode === "cookie" && "browserAccessToken" in auth
          ? auth.browserAccessToken
          : auth.accessToken,
        refreshToken: "refreshToken" in auth ? auth.refreshToken : undefined,
        sessionMode,
      });
    }
    case "Client_GetUserInfo": {
      return ok({
        ID: ctx.user.id,
        UserName: ctx.user.userName,
        Setting: ctx.user.setting || {},
        CreditPlateUserName: resolveCreditPlateUserName(ctx.user),
        IsAdmin: isAdminUser(ctx.user),
        Role: ctx.user.role || "user",
        TeamId: ctx.user.teamId || null,
        MarketHubOrigin: resolveMarketHubOriginForUser(ctx.user.userName),
      });
    }
    case "Client_UpdateSetting": {
      let patch = body.setting ?? body;
      if (typeof patch === "string") {
        try { patch = JSON.parse(patch); }
        catch { return fail("invalid setting json"); }
      }
      if (!patch || typeof patch !== "object" || Array.isArray(patch))
        return fail("setting required");
      let user;
      try {
        user = await store.updateUserSetting(ctx.user.id, patch);
      }
      catch {
        return fail("设置保存失败，请重试");
      }
      if (!user)
        return fail("user not found");
      return ok(user.setting || {});
    }
    case "Client_GetCollectPlatform": {
      const cpParsed = GetCollectPlatformRequest.safeParse(body);
      const provider = cpParsed.success ? cpParsed.data.provider : String(body.provider || "");
      const row = store.getPlatform(provider);
      const catalogBetName = getPlatformRules(provider, getDefaultMarketCode())?.betName || ".*";
      if (!row) {
        const empty: Record<string, unknown> = { Gateway: "", Token: "", BetName: catalogBetName };
        // VPS 采集索引不依赖 platforms.json 行；无行也要下发（按合场筛后）订阅集
        await attachFilteredVpsMarketIndex(provider, empty);
        return ok(empty);
      }
      const betName = row.betName && row.betName !== ".*" ? row.betName : catalogBetName;
      let gateway: string = row.gateway || "";
      let token: string = row.token || "";

      if (provider === "Stake") {
        gateway = row.gateway || row.apiUrl || "https://stake.com";
        token = row.accessToken || row.token || "";
      }
      if (provider.toUpperCase() === "TF") {
        try {
          const { getTfA8CollectCredentials } = requirePlatform("TF", "node", "collect_credentials.js");
          const a8 = await getTfA8CollectCredentials();
          store.setPlatform("TF", {
            gateway: a8.gateway,
            token: a8.token,
            betName: a8.betName || betName,
            games: a8.games,
          });
          return ok({ Gateway: a8.gateway, Token: a8.token, BetName: a8.betName || betName });
        }
        catch (err: any) {
          console.warn("[TF] local Client_GetCollectPlatform failed:", err.message);
          const fallback = store.getPlatform("TF");
          if (fallback?.gateway && fallback?.token) {
            return ok({ Gateway: fallback.gateway, Token: fallback.token, BetName: fallback.betName || betName });
          }
          return ok({ Gateway: "", Token: "", BetName: catalogBetName });
        }
      }
      if (provider.toUpperCase() === "IA") {
        const { getIaA8CollectCredentials } = requirePlatform("IA", "node", "collect_credentials.js");
        const a8 = getIaA8CollectCredentials();
        return ok({
          Gateway: a8.gateway,
          Token: a8.token,
          BetName: betName && betName !== ".*" ? betName : a8.betName,
        });
      }
      const out: Record<string, unknown> = { Gateway: gateway, Token: token, BetName: betName };
      if (provider.toUpperCase() === "OB" && row?.gameOddTypes) {
        out.GameOddTypes = row.gameOddTypes;
      }
      await attachFilteredVpsMarketIndex(provider, out);
      return ok(out);
    }
    case "Client_GetGames": {
      const ggParsed = GetGamesRequest.safeParse(body);
      const provider = ggParsed.success ? ggParsed.data.provider : String(body.provider || "");
      const fromCatalog = gamesForProvider(provider);
      const row = store.getPlatform(provider);
      const fromPlatform: string[] = Array.isArray(row?.games) ? row.games.map(String) : [];
      return ok([...new Set([...fromCatalog, ...fromPlatform])]);
    }
    case "API_UpdatePlatform": {
      const upParsed = UpdatePlatformRequest.safeParse(body);
      if (!upParsed.success)
        return fail("provider required");
      if (String(upParsed.data.provider || "").toUpperCase() === "OB") {
        const { looksLikeSportObCollectPaste } = await import("./sport_ob_session.js");
        if (looksLikeSportObCollectPaste({ ...body, ...upParsed.data }))
          return fail("体育 OB 会话请贴到足球页，勿写入电竞采集");
      }
      const prev = store.getPlatform(upParsed.data.provider) || {};
      const next = store.setPlatform(upParsed.data.provider, {
        gateway: upParsed.data.gateway ?? prev.gateway ?? "",
        token: upParsed.data.token ?? prev.token ?? "",
        betName: upParsed.data.betName ?? prev.betName ?? ".*",
        games: upParsed.data.games ? JSON.parse(upParsed.data.games) : prev.games,
      });
      return ok(next);
    }
    case "API_SaveMatch": {
      const smParsed = SaveMatchRequest.safeParse(body);
      if (!smParsed.success)
        return fail("provider and matchs required");
      let matchs: unknown[] = [];
      try { matchs = JSON.parse(smParsed.data.matchs); }
      catch { return fail("invalid matchs json"); }
      store.saveMatches(smParsed.data.provider, matchs);
      return ok(true);
    }
    case "API_SaveBet": {
      const sbParsed = SaveBetRequest.safeParse(body);
      if (!sbParsed.success)
        return fail("provider, matchId and bets required");
      let bets: unknown[] = [];
      try { bets = JSON.parse(sbParsed.data.bets as string); }
      catch { return fail("invalid bets json"); }
      store.saveBets(sbParsed.data.provider, sbParsed.data.matchId, bets);
      return ok(true);
    }
    case "API_SaveLiveTimer": {
      const stParsed = SaveLiveTimerRequest.safeParse(body);
      if (!stParsed.success)
        return fail("provider and timer required");
      let timer: unknown[] = [];
      try { timer = JSON.parse(stParsed.data.timer); }
      catch { return fail("invalid timer json"); }
      await store.saveLiveTimer(stParsed.data.provider, timer);
      return ok(true);
    }
    case "Client_GetMatchs": {
      const list = await store.buildMatchList();
      const warn = warnClientGetMatchsOutbound(list);
      if (!warn.ok) {
        const st = getGetMatchsOutboundWarnStats();
        if (st.issueEvents === 1 || st.issueEvents % 50 === 0) {
          console.warn(
            `[GetMatchs] outbound warn issues=${warn.issues.length} pfSources=${warn.pfSourceCount}`
            + ` events=${st.issueEvents}: ${warn.issues.slice(0, 5).join(" | ")}`,
          );
        }
      }
      return ok(list);
    }
    case "Client_GetBaseballMatchs":
      try {
        return ok(await store.buildBaseballMatchList());
      }
      catch (err) {
        console.error("[GetBaseballMatchs]", err?.message || err);
        return fail(err?.message || "GetBaseballMatchs failed");
      }
    case "Client_GetFootballMatchs":
      try {
        return ok(await store.buildFootballMatchList());
      }
      catch (err) {
        console.error("[GetFootballMatchs]", err?.message || err);
        return fail(err?.message || "GetFootballMatchs failed");
      }
    case "Client_GetFootballMatchMarkets":
      return ok([]);
    case "Client_GetSportObSession": {
      const { publicSportObSession } = await import("./sport_ob_session.js");
      return ok(publicSportObSession());
    }
    case "API_UpdateSportObSession": {
      const sess = await import("./sport_ob_session.js");
      const { clearObFootballMatchCache } = await import("./sport_ob_football_fetch.js");
      if (body.clear === true || body.data === "") {
        sess.clearSportObSession();
        clearObFootballMatchCache();
        return ok(sess.publicSportObSession());
      }
      const parsed = sess.parseSportObSessionInput(body.data ?? body);
      if (!parsed.ok)
        return fail(parsed.msg);
      sess.writeSportObSession(parsed.session);
      clearObFootballMatchCache();
      return ok(sess.publicSportObSession());
    }
    case "Client_GetTennisMatchs":
      try {
        return ok(await store.buildTennisMatchList());
      }
      catch (err) {
        console.error("[GetTennisMatchs]", err?.message || err);
        return fail(err?.message || "GetTennisMatchs failed");
      }
    case "Client_GetBasketballMatchs":
      try {
        return ok(await store.buildBasketballMatchList());
      }
      catch (err) {
        console.error("[GetBasketballMatchs]", err?.message || err);
        return fail(err?.message || "GetBasketballMatchs failed");
      }
    case "API_SaveScore":
      return ok(true);
    case "Client_GetDefaultOdds": {
      const betId = Number(body.betId);
      const team = String(body.team || "");
      if (!betId || (team !== "Home" && team !== "Away"))
        return fail("betId / team ??");
      const odds = await store.getDefaultOddsSingle(betId, team);
      return ok({ odds });
    }
    case "Client_GetMatchDefaultOdds": {
      let matchIds: unknown[] = [];
      try { matchIds = JSON.parse((body.matchs as string) || "[]"); }
      catch { return fail("matchs JSON ??"); }
      return ok(await store.getMatchDefaultOdds(matchIds));
    }
    case "Client_NotifyAdminTelegram": {
      if (!ctx.user)
        return fail("未登录");
      const mirrored = await handleClientNotifyAdminTelegram(body, ctx.user);
      return mirrored.ok ? ok(true) : fail(mirrored.msg);
    }
    case "SendMessage": {
      const sent = await sendTelegramMessage(body);
      return sent.ok ? ok(true) : fail(sent.msg);
    }
    default:
      return fail(`unknown action: ${action}`);
  }
}

// ?? HTTP layer ???????????????????????????????????????????????????????????????

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

export async function handleEsportRequest(
  req: IncomingMessage,
  res: ServerResponse,
  urlPath: string,
): Promise<true> {
  const startedAt = Date.now();
  const action = actionFromUrl(urlPath);
  try {
    store.ensureSeed();
    await accountStore.ensureSeed();
    if (!action) { sendJson(res, 404, fail("missing action")); return true; }
    if (req.method !== "POST" && req.method !== "GET") {
      sendJson(res, 405, fail("method not allowed"));
      return true;
    }

    let body: Record<string, unknown> = {};
    if (req.method === "POST") {
      try { body = await parseRequest(req); }
      catch (err: any) {
        sendJson(res, 400, fail(err.message));
        return true;
      }
    }

    const token = String(req.headers.token || ""); // Node.js 请求头键名一律小写
    const clientIp = clientIpFromRequest(req);
    const cert = readClientCertStatus(req);
    const audit = {
      clientIp,
      certCn: clientCertCnFromSubject(cert.subject),
      userAgent: String(req.headers["user-agent"] || ""),
    };
    // 登录不依赖既有 session；先走 login，避免 RDS/池堵死时 getUserByToken 拖死登录
    if (action === "Client_Login") {
      sendJson(res, 200, await handleClientLogin(
        body,
        clientIp,
        cert,
        audit.userAgent,
        res,
      ));
      return true;
    }

    const browserSessionToken = browserSessionEnabled() ? readBrowserSessionCookie(req) : "";
    const resolved = await resolveRequestAuth({ token, browserSessionToken, action, audit }, {
      authBrowserSession: sb.authBrowserSession,
      authGetUserStatus: sb.authGetUserStatus,
      getProfileById: dbStore.getProfileById,
      loadProfileById: dbStore.loadProfileById,
    });
    if (resolved.failure && !PUBLIC_ACTIONS.has(action)) {
      if (shouldAuditAccessFailure(resolved.userId, resolved.failure.code))
        void sb.recordAuthAudit({ ...audit, userId: resolved.userId, eventType: "ACCESS", result: "DENIED", reasonCode: resolved.failure.code });
      sendJson(res, 200, resolved.failure);
      return true;
    }
    const { token: effectiveToken, user } = resolved;

    sendJson(res, 200, await handle(action, body, {
      token: effectiveToken,
      user,
      audit,
      browserSessionToken,
      response: res,
    }));
    return true;
  }
  catch (err: any) {
    console.error("[esport]", action || urlPath, err);
    if (!res.headersSent)
      sendJson(res, 200, fail(err.message || "服务器错误"));
    return true;
  }
  finally {
    recordEsportRequest(action || urlPath, Date.now() - startedAt);
  }
}

function handleIp(req: IncomingMessage, res: ServerResponse): true {
  const ip
    = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
      || req.socket?.remoteAddress
      || "127.0.0.1";
  sendJson(res, 200, ok({ IP: ip, Address: ip === "127.0.0.1" ? "??" : ip }));
  return true;
}

async function handleIpAddress(req: IncomingMessage, res: ServerResponse): Promise<true> {
  if (req.method !== "POST") { sendJson(res, 405, fail("method not allowed")); return true; }
  let body: string[] = [];
  try {
    const raw = await readBody(req);
    body = raw ? JSON.parse(raw) : [];
  }
  catch { body = []; }
  const info: Record<string, string> = {};
  for (const ip of body) info[String(ip)] = String(ip);
  sendJson(res, 200, ok(info));
  return true;
}

function handleEsportAhao(req: IncomingMessage, res: ServerResponse, urlPath: string): true {
  if (urlPath.includes("/api/Auth/phblist")) {
    sendJson(res, 200, { users: [] });
    return true;
  }
  sendJson(res, 200, ok(null));
  return true;
}

export async function tryEsportApi(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const urlPath = req.url!.split("?")[0];
  if (isWsForwardHttpPath(urlPath))
    return false;
  if (urlPath.startsWith("/esport/"))
    return handleEsportRequest(req, res, urlPath);
  if (urlPath.startsWith("/esport-ahao/"))
    return handleEsportAhao(req, res, urlPath);
  if (urlPath.startsWith("/v4.0/"))
    return handleV4Request(req, res, urlPath);
  if (urlPath.startsWith("/common/"))
    return handleCommonApi(req, res, req.url);
  if (urlPath === "/IP" || urlPath === "/IP/Address") {
    return urlPath === "/IP/Address" ? handleIpAddress(req, res) : handleIp(req, res);
  }
  return false;
}

/**
 * IPC / ?????? ????handleEsportRequest ??????????HTTP req/res?? * ?????? ApiEnvelope????throw??
 */
export async function callEsportAction(
  action: string,
  body: Record<string, unknown>,
  token: string,
): Promise<ApiEnvelope> {
  try {
    store.ensureSeed();
    await accountStore.ensureSeed();
    // IPC ????action ????query string?? "API_SaveMatch?XBet"?????
    const cleanAction = String(action || "").split("?")[0];
    if (!cleanAction)
      return fail("missing action");
    const user = await store.getUserByToken(token);
    if (cleanAction === "Client_Login")
      return handleClientLogin(body);
    return handle(cleanAction, body || {}, { token, user });
  }
  catch (err: any) {
    console.error("[esport:ipc]", action, err);
    return fail(err.message || "服务器错误");
  }
}
