/** 对齐 A8 bundle TQ / WZe / $Ze / LZe / UZe / VZe / Hd / k0 */

export interface HgToken {
  uid: string;
  ver: string;
  username?: string;
}

export interface HgItemParts {
  gtype: string;
  wtype: string;
  team: string;
  gid: string;
}

export interface HgFollowOrder {
  TID: string;
  NAME0?: string;
  _EVENT: string | number;
  NUM_H: string | number;
  NUM_C: string | number;
  GTYPE: string;
  WAGERSTYPE: string;
  ORDER_TYPE?: string;
  TEAM_H?: string;
  TEAM_C?: string;
  GOLD?: string | number;
  SHOWTEXT_ORDER_TYPE_IORATIO?: string;
  ODDF_TYPE?: string;
}

const WAGER_TYPE_MAP: Record<string, string> = {
  "(滚球) 让球": "RE",
  "(滚球) 大 / 小": "ROU",
};

export function parseHgToken(raw?: string): HgToken | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as HgToken;
    if (!parsed.uid || !parsed.ver) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function hgTransformUrl(gateway: string, token: HgToken): string {
  const base = gateway.replace(/\/+$/, "");
  return `${base}/transform.php?ver=${token.ver}`;
}

export function xmlTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i");
  const m = re.exec(xml || "");
  return m ? m[1]!.trim() : null;
}

export function parseHgServerResponse(xml: string) {
  return {
    code: xmlTag(xml, "code") || "",
    errormsg: xmlTag(xml, "errormsg") || "",
    ioratio: xmlTag(xml, "ioratio") || "",
    con: xmlTag(xml, "con") || "",
    ratio: xmlTag(xml, "ratio") || "",
    nowcredit: xmlTag(xml, "nowcredit") || "",
    msg: xmlTag(xml, "msg") || "",
    maxcredit: xmlTag(xml, "maxcredit") || "",
    currency: xmlTag(xml, "currency") || "",
    username: xmlTag(xml, "username") || "",
  };
}

function resolveTeam(order: HgFollowOrder, wtype: string): string | undefined {
  switch (wtype) {
    case "RE":
    case "R":
      if (order.ORDER_TYPE === order.TEAM_H) return "H";
      if (order.ORDER_TYPE === order.TEAM_C) return "C";
      if (order.ORDER_TYPE === "和局") return "N";
      return undefined;
    case "ROU":
    case "OU":
      if (order.ORDER_TYPE === "大") return "C";
      if (order.ORDER_TYPE === "小") return "H";
      return undefined;
    default:
      return undefined;
  }
}

export function hgItemIdFromOrder(order: HgFollowOrder): string {
  const wtype = WAGER_TYPE_MAP[order.WAGERSTYPE] || order.WAGERSTYPE;
  const team = resolveTeam(order, wtype);
  return [order.GTYPE, wtype, team, order._EVENT].join(":");
}

export function hgBetIdFromOrder(order: HgFollowOrder): string {
  return `${order._EVENT}:${order.GTYPE}`;
}

export function hgMatchIdFromOrder(order: HgFollowOrder): string {
  return `${order._EVENT}:${order.NUM_H}:${order.NUM_H}`;
}

export function parseHgItemId(itemId: string): HgItemParts {
  const [gtype, wtype, team, gid] = itemId.split(":");
  return { gtype: gtype || "", wtype: wtype || "", team: team || "", gid: gid || "" };
}

export function parseHgFollowOdds(order: HgFollowOrder): number {
  const text = stripHtml(order.SHOWTEXT_ORDER_TYPE_IORATIO || "");
  const m = /@\s+([\d.]+)$/.exec(text);
  if (!m) return 0;
  let odds = Number(m[1]) || 0;
  if (order.ODDF_TYPE === "香港盘") odds += 1;
  return odds;
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, "").trim();
}

export const HG_FOLLOW_MAX_RETRY = 200;
const HG_RETRY_PREFIX = "HG:";

export function hgFollowRetryCount(tid: string): number {
  return Number(localStorage.getItem(`${HG_RETRY_PREFIX}${tid}`) ?? "0");
}

export function recordHgFollowResult(tid: string, success?: boolean) {
  const key = `${HG_RETRY_PREFIX}${tid}`;
  if (success) {
    localStorage.setItem(key, String(HG_FOLLOW_MAX_RETRY));
    return;
  }
  const next = hgFollowRetryCount(tid) + 1;
  localStorage.setItem(key, String(next));
}

export function shouldSkipHgFollow(tid: string): boolean {
  return hgFollowRetryCount(tid) >= HG_FOLLOW_MAX_RETRY;
}
