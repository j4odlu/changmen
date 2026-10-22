import axios from "axios";

/**
 * [A8 可证实] index0706.js `Mr` / `gr`：浏览器端 Axios（XHR 适配器），非 fetch。
 * - timeout: 15_000
 * - validateStatus: 500/504 拒绝，其余状态交由场馆业务判断（A8 `![500,504].includes`）
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
