/** 由 web 在启动时注入；venue-adapter 拼 WS/HTTP 鉴权 URL 时读取。 */
type AuthTokenGetter = () => string | null | undefined;

let _getter: AuthTokenGetter | null = null;
let _handshakeGetter: (() => Promise<string>) | null = null;
let _cookieGetter: (() => boolean) | null = null;
export function setChangmenCookieSessionGetter(getter: (() => boolean) | null): void { _cookieGetter = getter; }
export function usesChangmenCookieSession(): boolean { return Boolean(_cookieGetter?.()); }

/** [changmen 扩展] 每次私有握手重新取得凭证，刷新由宿主执行。 */
export function setChangmenHandshakeTokenGetter(getter: (() => Promise<string>) | null): void {
  _handshakeGetter = getter;
}

export async function getChangmenHandshakeToken(): Promise<string> {
  return _handshakeGetter ? _handshakeGetter() : getChangmenAuthToken();
}

export function setChangmenAuthTokenGetter(getter: AuthTokenGetter | null): void {
  _getter = getter;
}

function readTokenFromStorage(): string {
  try {
    if (typeof localStorage !== "undefined") {
      const fromLs = String(localStorage.getItem("app:token") || "").trim();
      if (fromLs)
        return fromLs;
    }
  }
  catch {
    /* ignore */
  }
  try {
    if (typeof document === "undefined")
      return "";
    const m = document.cookie.match(/(?:^|; )app_token=([^;]*)/);
    return m ? decodeURIComponent(m[1]).trim() : "";
  }
  catch {
    return "";
  }
}

export function getChangmenAuthToken(): string {
  try {
    // 安装了宿主 getter 后，空值代表已退出；不能捡回存储里的旧凭证。
    if (_getter)
      return String(_getter() || "").trim();
  }
  catch {
    /* fall through */
  }
  return readTokenFromStorage();
}
