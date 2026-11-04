/** CLOB 已归一化的十进制数量/金额；不猜测单位，非法输入返回 0。 */
export function polymarketDecimalAmount(raw: unknown): number;
/** 原始 POST /order 的六位整数基本单位；非法输入返回 0。 */
export function polymarketBaseUnitAmount(raw: unknown): number;
