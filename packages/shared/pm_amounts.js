/** 已归一化的 CLOB 订单、成交和 Builder 数量/金额，单位由字段契约决定。
 * https://docs.polymarket.com/trading/manage-orders
 * 不根据数值大小或有无小数点猜测单位；非法输入沿用调用方的缺值处理。
 */
export function polymarketDecimalAmount(raw) {
  if (typeof raw !== "string" && typeof raw !== "number") return 0;
  if (typeof raw === "string" && !/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw.trim())) return 0;
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

/** 原始 POST /order makingAmount/takingAmount：六位整数基本单位。
 * https://docs.polymarket.com/api-reference/trade/post-a-new-order
 * 与 GET /data/order、/data/trades 的归一化份数分开，转换时保留六位精度。
 */
export function polymarketBaseUnitAmount(raw) {
  if (typeof raw !== "string" && typeof raw !== "number") return 0;
  if (typeof raw === "number" && (!Number.isSafeInteger(raw) || raw < 0)) return 0;
  const digits = String(raw).trim();
  if (!/^\d+$/.test(digits)) return 0;
  const padded = digits.padStart(7, "0");
  const value = Number(`${padded.slice(0, -6)}.${padded.slice(-6)}`);
  return Number.isFinite(value) ? value : 0;
}
