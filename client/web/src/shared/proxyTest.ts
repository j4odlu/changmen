import { buildHttpRelayUrl } from "@changmen/api-contract/urls";
import { getRequestAuthHeaders } from "@/lib/authCredentials";
import { getApiBase } from "@/config/apiBase";
/** 对齐 console `mr.test`：Axios 经本地 PROXY 中继访问 `/IP` */
import { a8Axios } from "@changmen/client-core/shared/a8Axios";

function proxyRelayEntry(): string {
  const proxyOrigin
    = typeof localStorage !== "undefined" ? localStorage.getItem("PROXY")?.trim() : "";
  return buildHttpRelayUrl({ apiBase: getApiBase(), proxyOrigin: proxyOrigin || undefined });
}

export interface ProxyTestResult {
  delay: number;
  ip?: string;
  address?: string;
}

export async function testProxyUrl(proxyUrl: string): Promise<ProxyTestResult | undefined> {
  const started = Date.now();
  try {
    const res = await a8Axios.get<{ info?: { IP?: string; Address?: string } }>(
      proxyRelayEntry(),
      {
        withCredentials: true,
        headers: {
          ...await getRequestAuthHeaders(proxyRelayEntry()),
          "x-proxy": proxyUrl,
          "x-proxy-url": "/IP",
        },
      },
    );
    if (res.status !== 200 || !res.data?.info)
      return undefined;
    return {
      delay: Date.now() - started,
      ip: res.data.info.IP,
      address: res.data.info.Address,
    };
  }
  catch {
    return undefined;
  }
}
