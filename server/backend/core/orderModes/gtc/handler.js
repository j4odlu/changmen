/** [changmen 扩展] 独立协调面；PM HTTP 仍由客户端执行，不在服务端监控/下注。 */
import { createPmGtc, listPmGtc, mutatePmGtc } from "@changmen/db";
import { gtcUnits } from "@changmen/shared/pm_gtc";
import { assertPlayerOwnedByUser } from "../../account/player_ownership.js";
import { refreshAccountsFromRdsIfEmpty } from "../../db/store.js";
import store from "../../esport-api/store.js";
import { getGtcOrders, saveGtcOrders } from "./orders.js";

const parse = value => typeof value === "string" ? JSON.parse(value) : value;
function walletMaker(raw) {
  let config;
  try { config = parse(raw); }
  catch { config = JSON.parse(Buffer.from(raw, "base64").toString("utf8")); }
  if (typeof config?.token === "string") {
    try { config = parse(config.token); }
    catch { config = JSON.parse(Buffer.from(config.token, "base64").toString("utf8")); }
  }
  const addressHeader = Object.entries(config?.polyHeaders ?? {}).find(([key]) => key.toLowerCase() === "poly_address")?.[1];
  return String(config?.funder || config?.funderAddress || config?.walletAddress || config?.address || addressHeader || "").toLowerCase();
}
export async function handlePmGtc(action, body, owner) {
  if (!owner)
    throw new Error("请先登录");
  if (action === "Pm_GtcOrders")
    return getGtcOrders(body, owner);
  if (action === "Pm_GtcSaveOrders") {
    const result = await saveGtcOrders(body, owner);
    if (!result.ok)
      throw new Error(result.msg);
    return result.info;
  }
  if (action === "Pm_GtcList")
    return listPmGtc(owner);
  const id = String(body.id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id))
    throw new Error("GTC 执行 ID 无效");
  if (action === "Pm_GtcCommand") {
    const command = parse(body.command);
    if (!command || !["authorize_pm", "authorize_other", "ack", "other", "facts", "close", "cancel", "cancel_result", "resume", "counted"].includes(command.kind))
      throw new Error("GTC 命令不支持");
    if (JSON.stringify(command).length > 2000000)
      throw new Error("GTC 事实过大");
    return mutatePmGtc(owner, id, Number(body.revision), command);
  }
  if (action !== "Pm_GtcCreate")
    throw new Error("GTC action 不支持");
  const submittedPlan = parse(body.plan);
  if (!submittedPlan || typeof submittedPlan !== "object")
    throw new Error("GTC 计划缺失");
  const plan = Object.fromEntries(["playerId", "otherPlayerId", "originalPmLeg", "otherProvider", "otherTarget", "otherOdds", "otherStake", "otherVenueMatchId", "otherVenueItemId", "matchId", "betRowId", "linkId", "tokenId", "conditionId", "target", "match", "bet", "item", "shares", "targetShares", "price", "maxPrincipal", "allInBudget", "fx", "parallel", "protocol", "negRisk", "route", "orderHash"].map(key => [key, submittedPlan[key]]));
  if (submittedPlan.source !== undefined && submittedPlan.source !== "manual")
    throw new Error("GTC 下单来源无效");
  const manual = submittedPlan.source === "manual";
  if (manual) {
    plan.source = "manual";
    if (plan.otherPlayerId !== 0 || plan.otherProvider !== "" || plan.otherOdds !== 0 || plan.otherStake !== 0
      || plan.originalPmLeg !== "A" || plan.parallel !== false) {
      throw new Error("手动 GTC 不能包含第二腿");
    }
  }
  const fee = submittedPlan.feeProof;
  plan.feeProof = fee && { rate: fee.rate, exponent: fee.exponent, takerOnly: fee.takerOnly, observedAt: fee.observedAt };
  if (!plan || !["A", "B"].includes(plan.originalPmLeg) || !["Home", "Away"].includes(plan.target)
    || !["Home", "Away"].includes(plan.otherTarget) || ![2, 3].includes(plan.protocol)
    || !/^0x[0-9a-f]{64}$/i.test(plan.orderHash)) {
    throw new Error("GTC 计划无效");
  }
  for (const key of ["price", "shares", "targetShares", "maxPrincipal", "allInBudget"]) {
    if (gtcUnits(plan[key]) <= 0n)
      throw new Error("GTC 定量/预算无效");
  }
  if (gtcUnits(plan.price) >= 1000000n || !(plan.fx > 0) || (!manual && (!(plan.otherOdds > 1) || !(plan.otherStake > 0)))
    || !Number.isFinite(plan.fx) || !Number.isFinite(plan.otherStake)) {
    throw new Error("GTC 价格/另一腿参数无效");
  }
  if (plan.feeProof?.exponent !== 1 || plan.feeProof?.takerOnly !== true)
    throw new Error("GTC 费用规则无效");
  gtcUnits(plan.feeProof.rate);
  if (gtcUnits(plan.shares) > gtcUnits(plan.targetShares) || gtcUnits(plan.maxPrincipal) > gtcUnits(plan.allInBudget)
    || typeof plan.parallel !== "boolean" || typeof plan.negRisk !== "boolean"
    || !Number.isFinite(plan.otherOdds)) {
    throw new Error("GTC 预算或执行参数无效");
  }
  for (const playerId of manual ? [plan.playerId] : [plan.playerId, plan.otherPlayerId]) {
    if (!Number.isSafeInteger(playerId) || playerId <= 0)
      throw new Error("GTC 账号 ID 无效或超出安全范围");
    const owned = await assertPlayerOwnedByUser(playerId, owner);
    if (!owned.ok)
      throw new Error(owned.msg);
  }
  await refreshAccountsFromRdsIfEmpty(owner);
  const accounts = store.getAccountsForUser(owner);
  const account = accounts.find(row => Number(row.accountId) === plan.playerId && row.provider === "Polymarket");
  if (!manual && !accounts.some(row => Number(row.accountId) === plan.otherPlayerId && row.provider === plan.otherProvider))
    throw new Error("GTC 对侧账号身份不一致");
  if (!account)
    throw new Error("PM 账号不存在");
  const maker = walletMaker(account.token);
  if (!/^0x[0-9a-f]{40}$/.test(maker))
    throw new Error("PM 钱包身份不确定，不能进入 GTC");
  if (String(body.maker).toLowerCase() !== maker)
    throw new Error("GTC 客户端与持久化钱包不一致");
  for (const alias of accounts.filter(row => row.provider === "Polymarket" && Number(row.accountId) !== plan.playerId)) {
    if (walletMaker(alias.token) === maker)
      throw new Error("GTC V1 暂不支持同钱包多个账号别名，请先合并账号，防止旧同步重复记账；FOK 不受此限制");
  }
  return createPmGtc({ id, owner, walletKey: `137:polymarket-collateral:${maker}`, maker, plan });
}
