import { authenticateIdentity } from "./identity.js";
import { cookieOnlyAuth } from "@changmen/storage/auth_mode.js";

const MESSAGES = {
  JWT_DISABLED: "旧登录凭证已停用，请刷新网页并重新登录；插件请更新至 1.3.74 或以上",
  COOKIE_LOGIN_REQUIRED: "旧登录接口已停用，请刷新网页，使用 Cookie 会话重新登录",
  AUTH_REQUIRED: "未登录",
  ACCESS_TOKEN_EXPIRED: "登录凭证已过期，请续期",
  REFRESH_TOKEN_EXPIRED: "会话已过期，请重新登录",
  SESSION_REVOKED: "会话已失效，请重新登录",
  TEMPORARY_UNAVAILABLE: "登录服务暂时不可用，请稍后重试",
  CREDENTIAL_CONFLICT: "登录凭证不一致，请刷新页面",
  CSRF_INVALID: "请求校验失败，请刷新页面",
  CERT_BIND_FAILED: "客户端证书与账号不匹配、已吊销或尚未登记",
};

export function authFailure(code) {
  return { success: 0, code, msg: MESSAGES[code] || MESSAGES.AUTH_REQUIRED, info: null };
}

const auditTimes = new Map();
/** 高频轮询到期时，同一用户/原因每分钟至多一条，避免故障时放大 RDS 写压力。 */
export function shouldAuditAccessFailure(userId, code, now = Date.now()) {
  if (!userId)
    return false;
  const key = `${userId}:${code}`;
  const previous = auditTimes.get(key);
  if (previous !== undefined && now - previous < 60_000)
    return false;
  if (auditTimes.size >= 1000)
    auditTimes.clear();
  auditTimes.set(key, now);
  return true;
}

/** 在业务分发之前完成鉴权，续期失败不能被压成 AUTH_REQUIRED。 */
export async function resolveRequestAuth({ token, browserSessionToken, action, audit, protocol }, deps) {
  if (cookieOnlyAuth() && ["Client_Login", "Client_RefreshToken", "Client_Logout"].includes(action))
    return { token: "", user: null, failure: authFailure("COOKIE_LOGIN_REQUIRED") };
  if (action === "Client_RefreshToken")
    return { token, user: null };
  if (deps.authResolveBrowserSession) {
    const identity = await authenticateIdentity({ token, browserSessionToken, protocol, audit }, deps);
    if (identity.code)
      return { token, user: null, userId: identity.userId, failure: authFailure(identity.code) };
    const user = deps.getProfileById(identity.userId) || await deps.loadProfileById(identity.userId);
    if (!user)
      return { token, user: null, failure: authFailure("TEMPORARY_UNAVAILABLE") };
    return { token: identity.credentialType === "cookie" ? "" : token, user,
      authMethod: identity.credentialType, session: identity.session, identity };
  }
  let effectiveToken = token;
  if (protocol === "cookie" && !browserSessionToken)
    return { token, user: null, failure: authFailure("AUTH_REQUIRED") };
  if (!effectiveToken && browserSessionToken) {
    const restored = await deps.authBrowserSession(browserSessionToken, audit);
    if (restored?.temporary)
      return { token, user: null, failure: authFailure("TEMPORARY_UNAVAILABLE") };
    if (!restored?.accessToken)
      return { token, user: null, failure: authFailure(restored?.revoked ? "SESSION_REVOKED" : "REFRESH_TOKEN_EXPIRED") };
    effectiveToken = restored.accessToken;
  }
  const auth = await deps.authGetUserStatus(effectiveToken);
  if (auth.code)
    return { token: effectiveToken, user: null, failure: authFailure(auth.code), userId: auth.userId };
  const user = deps.getProfileById(auth.userId) || await deps.loadProfileById(auth.userId);
  // profiles 加载失败不能证明用户退出。拒绝本次请求但保留客户端会话。
  if (!user)
    return { token: effectiveToken, user: null, failure: authFailure("TEMPORARY_UNAVAILABLE"), userId: auth.userId };
  return { token: effectiveToken, user, authMethod: "token" };
}
