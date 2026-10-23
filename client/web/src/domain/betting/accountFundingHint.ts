import type { PlatformAccount } from "@/models/platformAccount";

export function formatAccountFundingHint(
  accounts: PlatformAccount[],
  threshold: number,
): string {
  if (!accounts.length)
    return "无已加载账号";
  return accounts
    .map((acc) => {
      const bal = acc.getBalance();
      if (bal === undefined)
        return `${acc.provider}/${acc.playerName}:未加载`;
      const mark = bal < threshold ? `<${threshold}` : "";
      return `${acc.provider}/${acc.playerName}:${Math.floor(bal)}${mark}`;
    })
    .join("，");
}
