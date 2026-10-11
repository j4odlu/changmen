import { BuilderConfig, type BuilderHeaderPayload } from "@polymarket/builder-signing-sdk";

/** Fetch current application credentials for each signing call, never replay a transaction. */
export class SessionBuilderConfig extends BuilderConfig {
  constructor(private readonly signUrl: string, private readonly getAuthToken?: () => Promise<string>, private readonly getAuthHeaders?: () => Promise<Record<string, string>>) {
    super({ remoteBuilderConfig: { url: signUrl } });
  }

  override async generateBuilderHeaders(method: string, path: string, body?: string, timestamp?: number): Promise<BuilderHeaderPayload> {
    const token = this.getAuthHeaders ? "" : await this.getAuthToken?.();
    if (!this.getAuthHeaders && !token)
      throw new Error("登录凭证暂时无法恢复");
    const auth = this.getAuthHeaders ? await this.getAuthHeaders() : { "Authorization": `Bearer ${token}` };
    const response = await fetch(this.signUrl, {
      method: "POST", credentials: auth["X-Changmen-Auth"] === "cookie" ? "include" : "omit", signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({ method, path, body, timestamp }),
    });
    if (!response.ok)
      throw new Error(`Relayer 签名鉴权失败 (${response.status})`);
    const headers = await response.json() as BuilderHeaderPayload;
    if (!headers.POLY_BUILDER_SIGNATURE && !headers.RELAYER_API_KEY)
      throw new Error("Relayer 返回了无效签名");
    return headers;
  }
}
