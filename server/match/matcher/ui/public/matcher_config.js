(function () {
  const path = window.location.pathname;
  const onMatcher = /^\/matcher(\/|$)/i.test(path);
  const base = onMatcher ? "/matcher" : "";
  window.MATCHER_BASE = base;
  window.MATCHER_API = `${base}/api`;
  window.matcherUrl = function matcherUrl(rel) {
    if (!rel)
      return base || "/";
    if (!rel.startsWith("/"))
      rel = `/${rel}`;
    return base + rel;
  };
  window.matcherApi = function matcherApi(path) {
    if (!path)
      return window.MATCHER_API;
    if (!path.startsWith("/"))
      path = `/${path}`;
    return window.MATCHER_API + path;
  };

  function readTokenCookie() {
    const m = document.cookie.match(/(?:^|; )app_token=([^;]*)/);
    return m ? decodeURIComponent(m[1]) : "";
  }

  window.getSiteToken = function getSiteToken() {
    try {
      return localStorage.getItem("app:token") || readTokenCookie() || "";
    }
    catch {
      return readTokenCookie();
    }
  };

  window.matcherAuthHeaders = function matcherAuthHeaders() {
    const token = window.getSiteToken();
    return token ? { token } : {};
  };

  window.redirectToSiteLogin = function redirectToSiteLogin() {
    const dest = `/login?redirect=${encodeURIComponent(location.pathname + location.search)}`;
    location.replace(dest);
  };

  // 旧版访问令牌继续兼容；新版 HttpOnly 会话由 matcher API 在服务端认证。
  const token = window.getSiteToken();
  if (token && !readTokenCookie()) {
    document.cookie
      = `app_token=${encodeURIComponent(token)}; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax`;
  }

  window.formatPbTeamPlatformId = function formatPbTeamPlatformId(sourceGameId, teamId, gameCode) {
    const PB_GAME_SLUG_BY_CODE = {
      cs2: "cs2",
      kog: "king-of-glory",
      valorant: "valorant",
      lol: "league-of-legends",
      dota2: "dota-2",
    };
    function resolvePbGameSlug(src, code) {
      const raw = String(src ?? "").trim();
      if (raw) {
        for (const [c, slug] of Object.entries(PB_GAME_SLUG_BY_CODE)) {
          if (raw === slug || raw === c)
            return slug;
        }
        return raw;
      }
      if (code && PB_GAME_SLUG_BY_CODE[code])
        return PB_GAME_SLUG_BY_CODE[code];
      return "";
    }
    const gameId = resolvePbGameSlug(sourceGameId, gameCode);
    let pid = String(teamId ?? "").trim();
    if (!pid)
      return "";
    if (!gameId)
      return pid;
    const suffix = `@${gameId}`;
    if (pid.endsWith(suffix))
      return pid;
    const oldPrefix = `${gameId}:`;
    if (pid.startsWith(oldPrefix))
      pid = pid.slice(oldPrefix.length);
    const atIdx = pid.indexOf("@");
    if (atIdx > 0)
      pid = pid.slice(0, atIdx);
    return `${pid}@${gameId}`;
  };
})();
