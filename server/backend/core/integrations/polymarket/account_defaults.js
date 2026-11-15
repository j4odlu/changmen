import store from "../../esport-api/store.js";

/** PM 余额刷新沿用现有平台凭证补全；账号已有字段优先。 */
export function enrichPmAccountFromPlatformDefaults(account) {
  if (!account?.provider || (account.gateway && account.token))
    return account;
  const row = store.getPlatform(String(account.provider).toUpperCase());
  if (row?.gateway && row?.token) {
    return {
      ...account,
      gateway: account.gateway || row.gateway,
      token: account.token || row.token,
      referer: account.referer || row.referer || row.gateway,
    };
  }
  return account;
}
