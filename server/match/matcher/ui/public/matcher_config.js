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
  window.matcherSessionHeaders = async function matcherSessionHeaders() {
    const response = await fetch('/auth/session', { credentials: 'include', cache: 'no-store' });
    if (response.status === 404 || response.status === 401)
      return window.matcherAuthHeaders();
    if (!response.ok)
      throw new Error('登录服务暂时不可用，请稍后重试');
    const info = await response.json();
    // 双轨登录也可能只有 HttpOnly 会话；写请求必须携带服务端签发的 CSRF。
    if (info.csrfToken)
      return { 'X-Changmen-Auth': 'cookie', 'X-CSRF-Token': info.csrfToken };
    if (info.cookieEnabled || !window.getSiteToken())
      throw new Error('登录请求校验未配置，请检查后端 WEB_AUTH_CSRF_SECRET 后刷新页面');
    return window.matcherAuthHeaders();
  };

  window.matcherForbiddenMessage = function matcherForbiddenMessage(data) {
    const code = data.code || data.error;
    if (code === 'CSRF_INVALID')
      return '请求校验失败（CSRF），请刷新赛事匹配页面；这不是账号权限不足';
    if (code === 'forbidden' || code === 'FORBIDDEN')
      return data.message || '需要团队长或管理员权限';
    return data.message || data.error || '请求被拒绝（HTTP 403），请刷新后重试';
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
