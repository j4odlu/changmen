import { resolveOrderItemLabel } from "@/shared/orderItemDisplay";

/** [changmen 扩展] 订单 Item 按纯文本显示，与普通订单相同地解码赛事名称实体。 */
export function gtcOrderItemText(item: string, match: string): string {
  const entities: Record<string, string> = { apos: "'", quot: "\"", amp: "&", lt: "<", gt: ">", nbsp: " " };
  return resolveOrderItemLabel(item, match)
    .replace(/&(?:#(\d+)|#x([\da-f]+)|(apos|quot|amp|lt|gt|nbsp));/gi, (entity, decimal: string | undefined, hex: string | undefined, named: string | undefined) => {
      if (named) return entities[named.toLowerCase()]!;
      const point = decimal ? Number(decimal) : Number.parseInt(hex!, 16);
      return point > 0 && point <= 0x10FFFF && !(point >= 0xD800 && point <= 0xDFFF) ? String.fromCodePoint(point) : entity;
    });
}
