import { LoginRequest } from "@changmen/api-contract/schemas";
import { cookieOnlyAuth } from "@changmen/storage/auth_mode.js";
import { browserSessionEnabled, setBrowserSessionCookie } from "./browser_session.js";
import { checkLoginRateLimit, recordLoginFailure, recordLoginSuccess } from "./login_rate_limit.js";
import { certLoginBindError, clientCertCnFromSubject } from "../shared/client_cert_gate.js";

const ok = info => ({ success: 1, msg: "ok", info: info ?? null });
const fail = (msg, info = null, code) => ({ success: 0, ...(code ? { code } : {}), msg, info });

/** Auth use case. Profile/account policy hooks are supplied by the application. */
export async function login(body, dependencies, clientIp = "", cert = null, userAgent = "", response) {
  if (cookieOnlyAuth() && !response)
    return fail("旧登录接口已停用，请刷新网页并使用 Cookie 登录", null, "COOKIE_LOGIN_REQUIRED");
  const { db, loadProfileById, assertProfileActive, touchUserPresence, recordUserLastLogin } = dependencies;
  const parsed = LoginRequest.safeParse({ userName: body.userName || body.username, password: body.password });
  if (!parsed.success)
    return fail("用户名或密码不能为空");
  const { userName, password } = parsed.data;
  const rate = checkLoginRateLimit(userName, clientIp);
  if (rate.limited) {
    void db.recordAuthAudit({
      userName,
      clientIp,
      userAgent,
      eventType: "LOGIN",
      result: "DENIED",
      reasonCode: "RATE_LIMITED",
    });
    return fail(`登录尝试过于频繁，请在 ${rate.retryAfterSec} 秒后重试`, null, "RATE_LIMITED");
  }
  if (!db.isAuthConfigured()) {
    return fail("未配置 JWT：请在 server/backend/.env 设置 JWT_SECRET，并配置 DATABASE_URL", null, "TEMPORARY_UNAVAILABLE");
  }

  const audit = {
    clientIp,
    certCn: clientCertCnFromSubject(cert?.subject),
    certFingerprint: cert?.fingerprint || '',
    userAgent,
  };

  // 已登记证书绑定不可变 userId；未知旧证书仅在兼容模式按 CN 验证。
  // 在验密之前拦截，避免无证/错证时泄露「密码是否正确」
  let binding;
  try {
    if (db.certificateRegistryEnabled?.() && cert?.fingerprint)
      binding = await db.getClientCertificate(cert.fingerprint);
  } catch { return fail('证书登记服务暂时不可用', null, 'TEMPORARY_UNAVAILABLE'); }
  const bindErr = binding
    ? binding.revoked_at || Number(binding.expires_at) <= Date.now() ? '客户端证书已吊销或过期' : null
    : certLoginBindError(userName, cert ?? null);
  if (bindErr) {
    recordLoginFailure(userName, clientIp);
    void db.recordAuthAudit({
      ...audit,
      userName,
      eventType: "LOGIN",
      result: "DENIED",
      reasonCode: "CERT_BIND_FAILED",
    });
    return fail(bindErr, null, "CERT_BIND_FAILED");
  }

  const auth = await db.authSignIn(userName, password, audit, {
    browserSession: Boolean(response && browserSessionEnabled()),
    validateProfile: async (profile) => {
      const error = db.certificateRegistryEnabled?.()
        ? await db.authorizeClientCertificate(audit, profile.id)
        : certLoginBindError(profile.userName, cert ?? null);
      if (error)
        throw Object.assign(new Error(error), { code: "CERT_BIND_FAILED" });
      await assertProfileActive(profile.id);
    },
  });
  if (auth?.error === "cert")
    return fail(auth.message, null, "CERT_BIND_FAILED");
  if (auth && "error" in auth && auth.error === "db") {
    return fail("数据库连接失败，请检查 DATABASE_URL 配置", null, "TEMPORARY_UNAVAILABLE");
  }
  if (!auth || "error" in auth)
  {
    recordLoginFailure(userName, clientIp);
    return fail("用户名或密码错误", null, "INVALID_CREDENTIALS");
  }

  const { accessToken, browserAccessToken, refreshToken, userId: uid, email } = auth;
  // The login transaction is already committed. Preserve its Cookie even if profile hydration fails.
  const sessionMode = response && auth.browserSession ? "cookie" : "legacy";
  if (response && auth.browserSession)
    setBrowserSessionCookie(response, auth.browserSession.token, auth.browserSession.absoluteExpiresAt);

  let profile = await loadProfileById(uid);
  if (!profile) {
    const inferredName = email.split("@")[0];
    const now = Date.now();
    const ok2 = await db.insertProfile(uid, {
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
      profile = await loadProfileById(uid);
  }
  if (!profile)
    return fail("登录已提交，用户资料暂时不可用，请刷新页面确认", null, "LOGIN_RESULT_UNCERTAIN");

  // 密码通过后再用 profile 用户名复核一次（防止大小写/别名与 CN 不一致）
  const bindName = String(profile.userName || userName || "").trim();
  const bindErr2 = db.certificateRegistryEnabled?.()
    ? await db.authorizeClientCertificate(audit, uid)
    : certLoginBindError(bindName, cert ?? null);
  if (bindErr2)
    return fail(bindErr2, null, "CERT_BIND_FAILED");

  try {
    await assertProfileActive(uid);
  }
  catch (err) {
    return fail(err.message || "账号状态异常，请联系管理员", null, "ACCOUNT_DISABLED");
  }

  touchUserPresence(uid);
  await recordUserLastLogin(uid, clientIp);
  recordLoginSuccess(userName, clientIp);

  return ok({
    ...(!cookieOnlyAuth() ? { token: sessionMode === "cookie" ? browserAccessToken : accessToken } : {}),
    ...(sessionMode === "legacy" ? { refreshToken } : {}),
    sessionMode,
    userName: profile.userName,
    ID: uid,
  });
}
