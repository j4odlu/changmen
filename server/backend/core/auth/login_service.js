import { LoginRequest } from "@changmen/api-contract/schemas";
import { browserSessionEnabled, setBrowserSessionCookie } from "./browser_session.js";
import { checkLoginRateLimit, recordLoginFailure, recordLoginSuccess } from "./login_rate_limit.js";
import { certLoginBindError, clientCertCnFromSubject } from "../shared/client_cert_gate.js";

const ok = info => ({ success: 1, msg: "ok", info: info ?? null });
const fail = (msg, info = null, code) => ({ success: 0, ...(code ? { code } : {}), msg, info });

/** Auth use case. Profile/account policy hooks are supplied by the application. */
export async function login(body, dependencies, clientIp = "", cert = null, userAgent = "", response) {
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
    userAgent,
  };

  // mTLS 叶子 CN 必须与登录用户名一致（生产默认开启；本机 DEV 默认关）
  // 在验密之前拦截，避免无证/错证时泄露「密码是否正确」
  const bindErr = certLoginBindError(userName, cert ?? null);
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
      const error = certLoginBindError(profile.userName, cert ?? null);
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
  const bindErr2 = certLoginBindError(bindName, cert ?? null);
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
    token: sessionMode === "cookie" ? browserAccessToken : accessToken,
    ...(sessionMode === "legacy" ? { refreshToken } : {}),
    sessionMode,
    userName: profile.userName,
    ID: uid,
  });
}
