/** [changmen 扩展] Shared runtime switch; dual/legacy remain explicit rollback modes. */
export function cookieOnlyAuth() {
  return String(process.env.AUTH_MODE || "dual").trim().toLowerCase() === "cookie";
}
