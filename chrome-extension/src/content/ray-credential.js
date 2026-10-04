/** Read RAY credentials from the current frame's storage. */
export function readRayToken(storage) {
  const token = storage.getItem("gameAuthToken") || storage.getItem("socketCluster.authToken");
  if (token) return token;

  const userToken = storage.getItem("userToken");
  if (userToken && /^\{/.test(userToken)) {
    try {
      const jwt = JSON.parse(userToken).JWT;
      if (jwt) return jwt;
    } catch {
      // A malformed legacy entry must not hide the current socket credential.
    }
  }

  // [changmen 扩展] ray164.com 用户截图：小写 socketcluster，且 key 带服务器域名后缀。
  const socketToken = storage.getItem("socketcluster.authToken");
  if (socketToken) return socketToken;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!/^socketcluster\.authToken\..+$/i.test(key || "")) continue;
    const value = storage.getItem(key);
    if (value) return value;
  }
  return undefined;
}

export function readRayPageSession(win = window) {
  return new Promise(resolve => {
    const requestId = crypto.randomUUID();
    const finish = session => {
      clearTimeout(timer);
      win.removeEventListener("message", onMessage);
      resolve(session);
    };
    const onMessage = event => {
      if (event.source !== win || event.origin !== win.location.origin
        || event.data?.source !== "changmen-ray-session-response"
        || event.data.requestId !== requestId) return;
      finish(event.data.session);
    };
    const timer = setTimeout(() => finish(undefined), 1500);
    win.addEventListener("message", onMessage);
    win.postMessage({ source: "changmen-ray-session-request", requestId }, win.location.origin);
  });
}

export async function readRayConfig(storage, referer, fetchConfig = fetch, session) {
  // [changmen 扩展] 官网当前 HTTP 会话优先；旧站点仍使用 A8 的 storage 读取顺序。
  const tokens = [...new Set([session?.token, readRayToken(storage)].filter(Boolean))];
  if (!tokens.length) return undefined;

  let gateways;
  try {
    // [A8 可证实] A8 插件 2.0.149：configv4.data.game_api → origin 数组。
    const response = await fetchConfig("https://api.365raylinks.com/configv4?platform=1", {
      signal: AbortSignal.timeout(10000),
    });
    const config = await response.json();
    gateways = config.data.game_api.map(value => {
      const url = new URL(value);
      if (!/^https?:$/.test(url.protocol)) throw new Error("Invalid gateway");
      return `${url.protocol}//${url.host}`;
    });
    if (!gateways.length) throw new Error("No gateways");
  } catch {
    // [changmen 扩展] 用现有 error 面板提示重试，不复制固定或空网关。
    return { error: "RAY 网关配置获取失败，请检查网络后重试" };
  }

  // 官网当前网关只在 configv4 列表内优先使用，不接受任意注入的地址。
  try {
    const current = new URL(session?.gateway).origin;
    if (gateways.includes(current)) gateways = [current, ...gateways.filter(g => g !== current)];
  } catch { /* Legacy pages have no runtime gateway. */ }

  let rejected = false;
  for (const token of tokens) {
    const raw = String(token).trim();
    const bearer = raw.startsWith("Bearer ") ? raw : `Bearer ${raw}`;
    for (const gateway of gateways) {
      try {
        // [changmen 扩展] SocketCluster JWT 不等于 HTTP 登录 token；复制前验证真实余额接口。
        const response = await fetchConfig(`${gateway}/v2/user`, {
          headers: { authorization: bearer }, signal: AbortSignal.timeout(5000),
        });
        const user = await response.json();
        if (user?.code === 401 || user?.desc === "TOKEN_ERROR") rejected = true;
        if (user?.code !== 200 || !user.result || user.result.balance == null) continue;
        const verifiedGateways = [gateway, ...gateways.filter(g => g !== gateway)];
        const payload = { provider: "RAY", gateway: verifiedGateways, token: bearer, referer };
        return { ...payload, gateway, data: btoa(JSON.stringify(payload)) };
      } catch { /* Try the remaining official gateways. */ }
    }
  }
  return { error: rejected
    ? "RAY 登录凭证被余额接口拒绝（TOKEN_ERROR），请重新登录 RAY 后重试；未复制无效凭证"
    : "RAY 余额接口验证失败，请确认场馆已登录且网络可用后重试；未复制无效凭证" };
}
