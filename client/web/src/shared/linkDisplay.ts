import type { OrderRow } from "@/types/order";
import {
  classifyLinkId,
  linkIdSourceLabel,
  type LinkIdSource,
} from "@changmen/client-core/shared/format";
import { isLinkedArbOrderGroup, isMakeupSyntheticOrderRow } from "@/shared/orderLink";

/** 与 admin / 侧栏共用的 Link 类型徽标 */
export interface LinkKindBadge {
  source: LinkIdSource;
  label: string;
  title: string;
}

const ARB_LINK_MIN = 1_000_000_000_000;

const KIND_TITLE: Record<LinkIdSource, string> = {
  arb: "套利 attempt 的正时间戳 Link（不表示组内一定有两腿）",
  single: "比例 9999 单边",
  lowOddsSingle: "LOS：双腿预检后只提交低赔腿，每盘口一次，不补单",
  valueBet: "正 EV 确认下单",
  hash: "未绑单占位（SaveOrder hash / create_at 占位）",
};

/** 完整数字展示（排障用）；0 → — */
export function formatLinkIdFull(link: number | null | undefined): string {
  const n = Number(link);
  if (!Number.isFinite(n) || n === 0)
    return "—";
  return String(n);
}

/** 进行中订单标题：后 6 位 + 类型短标 */
export function formatActiveBetLinkLabel(linkId: number | null | undefined): string | null {
  const n = Number(linkId);
  if (!Number.isFinite(n) || n === 0)
    return null;
  const tail = String(Math.abs(n)).slice(-6);
  const badge = resolveLinkKindBadge(n);
  if (!badge)
    return `Link ${tail}`;
  if (badge.source === "lowOddsSingle")
    return `Link ${tail} · 🎯LOS`;
  if (badge.source === "single")
    return `Link ${tail} · 🏆单边`;
  if (badge.source === "valueBet")
    return `Link ${tail} · 💎正EV`;
  if (badge.source === "hash")
    return `Link ${tail} · 未绑单`;
  return `Link ${tail} · 套利`;
}

export function resolveLinkKindBadge(linkId: number | null | undefined): LinkKindBadge | null {
  const source = classifyLinkId(linkId);
  const label = linkIdSourceLabel(source);
  if (!source || !label)
    return null;
  return {
    source,
    label: source === "hash" ? "未绑单" : label,
    title: KIND_TITLE[source],
  };
}

/**
 * 按订单组展示：套利 Link 但组内只有一腿 →「套利·单腿」
 *（对侧失败/拒单/未绑上时常见，避免误以为已成对）
 */
export function resolveOrderGroupKindBadge(rows: OrderRow[]): LinkKindBadge | null {
  const link = Number(rows[0]?.Link);
  const base = resolveLinkKindBadge(link);
  if (!base)
    return null;
  if (base.source !== "arb")
    return base;
  if (isLinkedArbOrderGroup(rows)) {
    return {
      ...base,
      label: "套利",
      title: "双腿已同 Link 成组",
    };
  }
  const realLegs = rows.filter(r => !isMakeupSyntheticOrderRow(r));
  if (realLegs.length <= 1) {
    return {
      ...base,
      label: "套利·单腿",
      title: "套利 attempt 的 Link，但组内仅一腿（对侧未成单/未绑上/已拒）",
    };
  }
  return {
    ...base,
    label: "套利",
    title: base.title,
  };
}

/** create_at−1 / 同 create_at / hash 占位 */
export function isUnboundPlaceholderLink(
  link: number | null | undefined,
  createAt?: number | null,
): boolean {
  const n = Number(link);
  if (!Number.isFinite(n) || n === 0)
    return true;
  if (n > 0 && n < ARB_LINK_MIN)
    return true;
  const ca = Number(createAt);
  if (Number.isFinite(ca) && ca > 0) {
    if (n === ca || n === ca - 1)
      return true;
  }
  return false;
}

/** 组内任一行仍是占位 → 侧栏标「未绑单」（短暂态） */
export function groupHasUnboundPlaceholder(rows: OrderRow[]): boolean {
  if (!rows.length)
    return false;
  const link = Number(rows[0]?.Link);
  const badge = resolveLinkKindBadge(link);
  if (badge?.source === "hash")
    return true;
  return rows.some(r => isUnboundPlaceholderLink(r.Link, r.CreateAt));
}
