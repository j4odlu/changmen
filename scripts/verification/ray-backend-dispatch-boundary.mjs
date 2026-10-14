// [changmen 扩展] 2391dc9d 已提交的更新专用分支；所有完整条件均精确匹配，普通保存全文继续核对。
export function restoreRayBackendDispatch(file, source, replaceExact) {
  if (file === "server/backend/core/account/account_service.js") {
    source = replaceExact(source, "import { listRayMonitorOrders } from \"./ray_monitor_orders.js\";");
    source = replaceExact(source, `if (body.rayMonitorOnly === true) {
      try {
        const orders = await listRayMonitorOrders(playerId, userId, body.orderIds ?? []);
        return { ok: true, info: { logs: [], orders } };
      }
      catch (error) {
        return { ok: false, msg: error instanceof Error ? error.message : "RAY 监控恢复失败" };
      }
    }`);
    return replaceExact(source, "body.type || body.Type || \"\", body.rayMonitorOnly === true ? { rayMonitorOnly: true } : undefined,", "body.type || body.Type || \"\",");
  }
  if (file !== "server/backend/core/account/order_store.js")
    return source;
  source = replaceExact(source, "export async function saveOrder(playerId, orders, userId, typeFallback = \"\", options = undefined)", "export async function saveOrder(playerId, orders, userId, typeFallback = \"\")");
  source = replaceExact(source, `if (options?.rayMonitorOnly && incomingResolved.some(({ o, orderId }) => {
    const previous = findOrderRowById(existingByOrderId, orderId);
    return !previous || previous.provider !== "RAY" || o.provider !== "RAY";
  })) return false;`);
  source = replaceExact(source, "if (options?.rayMonitorOnly && [\"win\", \"lose\", \"lost\", \"return\", \"reject\"].includes(String(prevRow.status).toLowerCase())) continue;");
  return replaceExact(source, "if (options?.rayMonitorOnly) return sb.patchRayMonitorOrders(rows);");
}
