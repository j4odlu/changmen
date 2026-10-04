import { getRefreshToken, isCookieAuthMode, usesWebCookieSession } from "@/api/client";
import { probeCookieSession, startWebSessionWatch, stopWebSessionWatch } from "@/lib/webSession";

/** JWT 模式：Client_RefreshToken 续期 */
export async function ensureTokenRefresh(): Promise<void> {
  if (import.meta.env.VITE_WEB_COOKIE_AUTH === "1") {
    startWebSessionWatch();
    await probeCookieSession(true, true);
    return;
  }
  const rft = getRefreshToken();
  if (isCookieAuthMode()) {
    startWebSessionWatch();
    if (await probeCookieSession())
      return;
    const { refreshJwtSession, startJwtAutoRefresh } = await import("@/lib/jwtRefresh");
    await refreshJwtSession();
    startJwtAutoRefresh();
    return;
  }
  if (!rft)
    return;

  const { refreshJwtSession, startJwtAutoRefresh } = await import("@/lib/jwtRefresh");
  await refreshJwtSession();
  startJwtAutoRefresh();
}

export async function stopTokenRefresh(): Promise<void> {
  stopWebSessionWatch();
  try {
    const { stopJwtAutoRefresh } = await import("@/lib/jwtRefresh");
    stopJwtAutoRefresh();
  }
  catch {
    /* ignore */
  }
}

export async function startTokenRefresh(): Promise<void> {
  if (import.meta.env.VITE_WEB_COOKIE_AUTH === "1") {
    startWebSessionWatch();
    if (!usesWebCookieSession()) await probeCookieSession(true, true);
    return;
  }
  if (isCookieAuthMode()) {
    startWebSessionWatch();
    if (usesWebCookieSession() || await probeCookieSession())
      return;
  }
  const { startJwtAutoRefresh } = await import("@/lib/jwtRefresh");
  startJwtAutoRefresh();
}
