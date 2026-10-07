/** 浏览器直连 GET/POST JSON（采集与部分场馆 API）— 对齐 A8 `Rr.get` / `Nr`（Axios + XHR） */

import { a8Axios, responseBodyText } from "./a8Axios";

export async function directGet<T>(url: string, headers: Record<string, string>, options?: { timeout?: number }): Promise<T> {
  const res = await a8Axios.get<T>(url, { headers, ...options });
  if (res.status >= 400) {
    const text = responseBodyText(res.data);
    throw Object.assign(new Error(text.slice(0, 160) || `HTTP ${res.status}`), {
      response: { status: res.status, headers: res.headers, data: res.data },
    });
  }
  return res.data;
}

export async function directPostJson<T>(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  options?: { timeout?: number },
): Promise<T> {
  const res = await a8Axios.post<T>(url, body, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
  if (res.status >= 400) {
    const text = responseBodyText(res.data);
    throw Object.assign(new Error(text.slice(0, 160) || `HTTP ${res.status}`), {
      response: { status: res.status, headers: res.headers, data: res.data },
    });
  }
  return res.data;
}

export async function directDeleteJson<T>(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<T> {
  const res = await a8Axios.delete<T>(url, {
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    data: body,
  });
  if (res.status >= 400) {
    const text = responseBodyText(res.data);
    throw new Error(text.slice(0, 160) || `HTTP ${res.status}`);
  }
  return res.data;
}
