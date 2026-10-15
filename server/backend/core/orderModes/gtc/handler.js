/** [changmen 扩展] 独立协调面；PM HTTP 仍由客户端执行，不在服务端监控/下注。 */
import { listPmGtc, listPmGtcClientImport } from "@changmen/db";
import { getGtcMonitorOrders, getGtcOrders, saveGtcOrders } from "./orders.js";
import { recoverPmGtc } from "./recovery.js";
import { readGtcConfirmedResults, syncGtcConfirmedResult } from "./results.js";

const parse = value => typeof value === "string" ? JSON.parse(value) : value;
export async function handlePmGtc(action, body, owner) {
  if (!owner)
    throw new Error("请先登录");
  if (action === "Pm_GtcSyncResult") return syncGtcConfirmedResult(body, owner);
  if (action === "Pm_GtcReadResults") return readGtcConfirmedResults(body, owner);
  if (action === "Pm_GtcCreate" || action === "Pm_GtcCommand")
    throw new Error("GTC 执行控制已迁移至客户端，请刷新客户端；订单结果由同步模块保存");
  if (action === "Pm_GtcRecover")
    return recoverPmGtc(body, owner);
  if (action === "Pm_GtcOrders")
    return getGtcOrders(body, owner);
  if (action === "Pm_GtcMonitorOrders")
    return getGtcMonitorOrders(body, owner);
  if (action === "Pm_GtcSaveOrders") {
    const result = await saveGtcOrders(body, owner);
    if (!result.ok)
      throw new Error(result.msg);
    return result.info;
  }
  if (action === "Pm_GtcList") {
    if (body.clientImport === true || body.clientImport === "true") return listPmGtcClientImport(owner);
    if (body.betRowId != null) {
      const betRowId = Number(body.betRowId);
      if (!Number.isSafeInteger(betRowId) || betRowId <= 0)
        throw new Error("GTC 盘口 ID 无效");
      return listPmGtc(owner, betRowId);
    }
    if (body.knownRevisions != null) {
      let known;
      try { known = parse(body.knownRevisions); }
      catch { throw new Error("GTC 已知版本无效"); }
      if (!known || typeof known !== "object" || Array.isArray(known) || Object.keys(known).length > 1000
        || Object.entries(known).some(([id, revision]) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
          || !Number.isSafeInteger(revision) || revision < 0)) {
        throw new Error("GTC 已知版本无效");
      }
      return listPmGtc(owner, undefined, known);
    }
    return listPmGtc(owner);
  }
  throw new Error("GTC action 不支持");
}
