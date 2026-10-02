/** Transport-independent credential validation. Business permissions belong to callers. */
export async function authenticateIdentity(input, deps) {
  try { return await resolveIdentity(input, deps); }
  catch { return { code: "TEMPORARY_UNAVAILABLE" }; }
}

async function resolveIdentity({ token = "", browserSessionToken = "", protocol, audit, fresh = false }, deps) {
  const cookieRequested = protocol === "cookie";
  if (cookieRequested && !browserSessionToken)
    return { code: "AUTH_REQUIRED" };
  const cookie = browserSessionToken && deps.authResolveBrowserSession
    ? await deps.authResolveBrowserSession(browserSessionToken, audit) : null;
  if (cookie?.temporary)
    return { code: "TEMPORARY_UNAVAILABLE" };
  const validCookie = cookie?.userId && !cookie.invalid && !cookie.revoked;
  const jwt = token ? await deps.authGetUserStatus(token, { fresh }) : null;
  if (jwt?.code === "TEMPORARY_UNAVAILABLE")
    return { code: jwt.code };
  if (validCookie && jwt && !jwt.code
    && (cookie.userId !== jwt.userId || cookie.jwtSessionId !== jwt.loginEpoch))
    return { code: "CREDENTIAL_CONFLICT" };
  if (cookieRequested || !token && browserSessionToken) {
    if (!validCookie)
      return { code: "SESSION_REVOKED" };
    return {
      userId: cookie.userId, sessionId: cookie.id, loginEpoch: cookie.jwtSessionId,
      credentialType: "cookie", session: cookie,
    };
  }
  if (!jwt || jwt.code)
    return { code: jwt?.code || "AUTH_REQUIRED", userId: jwt?.userId };
  return { userId: jwt.userId, sessionId: jwt.loginEpoch, loginEpoch: jwt.loginEpoch, credentialType: "token" };
}
