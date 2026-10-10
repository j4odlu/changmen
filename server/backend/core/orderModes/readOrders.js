import { fetchOrdersByExecutionPage } from "@changmen/db";
import { toDateKey } from "../account/order/date_key.js";
import { toClientOrder } from "../account/order/dto.js";
import { enrichOrdersBelongingToDate } from "../account/order/link.js";
import { attachPlayerDisplayToClientOrders } from "../account/order_store.js";
import { executionAnchors, partitionClientOrders } from "./identity.js";

export async function readOrdersForMode(body, owner, mode, records) {
  const date = body.date || toDateKey(Date.now());
  const pageIndex = Number(body.pageIndex) || 1;
  const pageSize = Number(body.pageSize) || 1024;
  const page = await fetchOrdersByExecutionPage(date, owner, mode, executionAnchors(records), pageIndex, pageSize);
  const merged = await enrichOrdersBelongingToDate(page.rows, date, { userId: owner });
  const formatted = await attachPlayerDisplayToClientOrders(merged.map(toClientOrder));
  const split = partitionClientOrders(formatted, records);
  const list = mode === "GTC" ? split.gtc : split.fok;
  return { list, total: list.length, pageIndex, pageSize };
}
