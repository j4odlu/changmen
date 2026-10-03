/** 订单/列表展示用账号名：优先场馆平台账号，回退 playerName */
export function accountOrderDisplayName(acc: {
  venueAccountName?: string;
  playerName?: string;
  accountId?: number;
} | null | undefined): string {
  if (!acc)
    return "";
  const venue = String(acc.venueAccountName || "").trim();
  if (venue)
    return venue;
  const name = String(acc.playerName || "").trim();
  if (name)
    return name;
  const id = Number(acc.accountId) || 0;
  return id ? `#${id}` : "";
}

/** [changmen 扩展] 实时进度与账号列表共用名称，缺失名称时不用内部编号冒充账号名。 */
export function accountProgressDisplayName(acc: {
  venueAccountName?: string;
  playerName?: string;
} | null | undefined): string {
  return accountOrderDisplayName(acc ? { venueAccountName: acc.venueAccountName, playerName: acc.playerName } : undefined) || "名称不可用";
}
