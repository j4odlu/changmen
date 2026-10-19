import axios from "axios";

/**
 * 对齐 A8 bundle `Nr` / `mr`：浏览器端 Axios（XHR 适配器），非 fetch。
 * - timeout: 15_000
 * - validateStatus: 500/504 不视为 throw（与 A8 `![500,504].includes` 一致）
 */
export const a8Axios = axios.create({
  timeout: 15_000,
  validateStatus: status => ![500, 504].includes(status),
});

export function responseBodyText(data: unknown): string {
  if (typeof data === "string")
    return data;
  if (data == null)
    return "";
  return JSON.stringify(data);
}
