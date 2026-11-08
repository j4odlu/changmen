/**
 * Predict.fun 语义 API（浏览器自签 + VPS 中继）
 *
 * 与旧 house 路径同一套官网协议：JWT 鉴权 + 已签 MARKET 单。
 * 差别只有钥匙在谁手里：
 *   - 旧：VPS 持 house Privy → 服务端自签 JWT / 代签下单 / 自查 GetOrder
 *   - 现：浏览器持用户 Privy → 客户端签单并带 jwt；VPS 只 POST/GET 中继，不碰钥、不碰 total_balance
 *
 * Pf_CheckBet：预检已在浏览器；本接口仅提示升级。
 */

import { assertPlayerOwnedByUser, isPredictFunPlayerRow } from "../../account/player_ownership.js";
import { PF_MEMBERSHIP_REMOVED_MSG } from "../../account/admin_pf.js";
import {
  loadPfOrdersStrict,
  publishPfBalanceKnown,
  resolvePfBalance,
  retryPendingPfLedgerCredits,
} from "./pf_player_account.js";
import {
  findPfOrderInList,
  rdsOrderKey,
  rdsOrderStatus,
  rdsPfHash,
  rdsToMapInput,
} from "./pf_order_row.js";
import { syncOfficialOrderToRds, lookupOfficialOrder } from "./pf_sync_official.js";
import { settleResolvedPfOrdersForPlayer } from "./pf_exec_settle.js";
import { mapPredictOrderToVenueOrder } from "./pf_orders.js";
import {
  listPfStuckOrdersForPlayer,
} from "./pf_recover_stuck.js";
import {
  toUserPfGetOrderInfo,
  toUserPfVenueOrders,
} from "./pf_user_dto.js";
import { predictFunPost } from "./pf_api.js";
import { isPredictFunOrderAccepted } from "./pf_order_service.js";
import { upsertPfServerOrder } from "./pf_server_order.js";
import { resolvePfOrderLabels } from "./pf_order_labels.js";
import { roundUsdt } from "./pf_ledger.js";
import { executePfUserSignedSell } from "./pf_exec_user_sell.js";
import { isPfSellClosing } from "./pf_lifecycle.js";
import {
  assertSignedOrderMatchesPredictAccount,
  loadPfPlayerPredictAccount,
} from "./pf_account_bind.js";

export { settleResolvedPfOrdersForPlayer };

/**
 * esport form-urlencoded 会把嵌套对象 JSON.stringify 成字符串（见 toEsportPostBody）。
 * 与 PM parseBodyField 同语义：字符串则 parse，已是对象则原样。
 */
export function parseEsportJsonField(raw) {
  if (raw == null || raw === "")
    return undefined;
  if (typeof raw === "object")
    return raw;
  const text = String(raw).trim();
  if (!text)
    return undefined;
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      return JSON.parse(text);
    }
    catch {
      return undefined;
    }
  }
  return undefined;
}

function requirePlayerId(body) {
  const playerId = body?.playerId;
  if (playerId == null || String(playerId).trim() === "")
    return { ok: false, msg: "playerId 必填" };
  return { ok: true, playerId };
}

async function assertPfPlayer(body, userId) {
  if (!userId)
    return { ok: false, msg: "请先登录" };

  const pid = requirePlayerId(body);
  if (!pid.ok)
    return pid;

  const owned = await assertPlayerOwnedByUser(pid.playerId, userId);
  if (!owned.ok)
    return owned;

  if (!isPredictFunPlayerRow(owned.player))
    return { ok: false, msg: `playerId ${pid.playerId} 不是 PredictFun 账号` };

  return { ok: true, playerId: pid.playerId, player: owned.player };
}

/**
 * 单笔对齐：closing 则 resume 关卖；否则 jwt? REST Get-by-hash :（仅历史 house 行）house 查。
 * @returns {{ venueOrder: object, refunded: boolean, settlement: string, found: boolean }}
 */
async function alignPfOrderWithOfficial(playerId, userId, rdsRow, jwt) {
  const orderKey = rdsOrderKey(rdsRow) || rdsPfHash(rdsRow);

  // 卖出确认中：与旧 house resume_closing 同语义，只是 JWT 换成用户的
  if (isPfSellClosing(rdsRow)) {
    if (!jwt) {
      return {
        venueOrder: mapPredictOrderToVenueOrder(null, rdsToMapInput(rdsRow)),
        refunded: false,
        settlement: "timeout",
        found: false,
      };
    }
    try {
      await executePfUserSignedSell({
        playerId,
        userId,
        buyOrderId: orderKey,
        jwt,
      });
      const refreshed = await loadPfOrdersStrict(playerId, userId);
      const closed = findPfOrderInList(refreshed, orderKey) ?? rdsRow;
      return {
        venueOrder: mapPredictOrderToVenueOrder(null, rdsToMapInput(closed)),
        refunded: false,
        settlement: "filled",
        found: true,
      };
    }
    catch (err) {
      console.warn("[Pf] sell closing resume", orderKey, err);
      return {
        venueOrder: mapPredictOrderToVenueOrder(null, rdsToMapInput(rdsRow)),
        refunded: false,
        settlement: "timeout",
        found: false,
      };
    }
  }

  const official = await lookupOfficialOrder(rdsRow, orderKey, { jwt });
  if (!official) {
    return {
      venueOrder: mapPredictOrderToVenueOrder(null, rdsToMapInput(rdsRow)),
      refunded: false,
      settlement: "timeout",
      found: false,
    };
  }

  const synced = await syncOfficialOrderToRds(playerId, userId, rdsRow, official);
  return {
    venueOrder: synced.venueOrder,
    refunded: synced.refunded,
    settlement: synced.settlement,
    found: true,
  };
}

/**
 * Pf_RefreshBalance — 用户刷新余额的主路径：
 * 1) VPS 扫官网赛果 / 卡住卖单
 * 2) 写 RDS
 * 3) 回 balance（+ 战绩统计）
 * 不依赖管理端拉单，也不做 VPS 后台定时扫。
 */
export async function handlePfRefreshBalance(body, userId) {
  const gate = await assertPfPlayer(body, userId);
  if (!gate.ok)
    return gate;
  try {
    // 结算不强制 house；卡住卖单补偿依赖 house，会员下线后跳过
    try {
      await settleResolvedPfOrdersForPlayer(gate.playerId, userId);
    }
    catch (err) {
      console.warn("[Pf_RefreshBalance] settle skipped", err);
    }
    const owned = await assertPlayerOwnedByUser(gate.playerId, userId);
    const player = owned.ok ? owned.player : gate.player;
    const balance = await resolvePfBalance(player, userId, gate.playerId);
    // 禁止绝对值 SET：仅同步 KV/统计，避免与并发 debit 竞态把余额写回去
    return await publishPfBalanceKnown(gate.playerId, userId, balance);
  }
  catch (err) {
    return { ok: false, msg: err instanceof Error ? err.message : String(err) };
  }
}

/** Pf_CheckBet — 预检已迁浏览器（checkPredictFunUserBuy）；保留 stub 提示 */
export async function handlePfCheckBet(_body, _userId) {
  return {
    ok: false,
    msg: "PredictFun 预检已改在浏览器执行；请升级客户端后重试",
  };
}

/**
 * Pf_SubmitOrder — 浏览器已签 MARKET FOK 中继。
 * body.mode === "userSigned"：jwt + createOrderBody → POST /v1/orders；不代签、不扣 total_balance。
 * 其它 mode：会员中转已下线。
 */
export async function handlePfSubmitOrder(body, userId) {
  const mode = String(body?.mode ?? "").trim();
  if (mode !== "userSigned")
    return { ok: false, msg: PF_MEMBERSHIP_REMOVED_MSG };

  const gate = await assertPfPlayer(body, userId);
  if (!gate.ok)
    return gate;

  const jwt = String(body?.jwt ?? "").trim();
  const createOrderBody = parseEsportJsonField(body?.createOrderBody);
  if (!jwt)
    return { ok: false, msg: "jwt 必填（用户 Predict Account 鉴权）" };
  if (!createOrderBody || typeof createOrderBody !== "object")
    return { ok: false, msg: "createOrderBody 必填（浏览器已签订单）" };

  const marketId = String(body?.marketId ?? "").trim();
  const tokenId = String(body?.tokenId ?? "").trim();
  if (!marketId || !tokenId)
    return { ok: false, msg: "marketId / tokenId 必填" };

  try {
    const predictAccount = await loadPfPlayerPredictAccount(gate.playerId);
    const bound = assertSignedOrderMatchesPredictAccount(createOrderBody, predictAccount);
    if (!bound.ok)
      return bound;

    // 必须先落 Pending 再 POST：否则官网已受理/成交后 RDS 写失败会孤儿仓位，
    // GetOrder 也找不到行，套利会当拒单补单 → 双暴露。
    const pfOrderHash = String(
      body?.orderHash
      ?? createOrderBody?.data?.order?.hash
      ?? "",
    ).trim();
    if (!pfOrderHash)
      return { ok: false, msg: "orderHash 必填（浏览器已签 hash）" };

    const bookOdds = Number(body?.bookOdds) || 0;
    const bookPrice = Number(body?.bookPrice) || 0;
    const apiBetMoney = Number(body?.apiBetMoney) || 0;
    const makerUsdt = Number(body?.makerUsdt);
    const stake = roundUsdt(
      Number.isFinite(makerUsdt) && makerUsdt > 0 ? makerUsdt : apiBetMoney,
    );
    const labels = resolvePfOrderLabels({
      marketId,
      tokenId,
      fromClient: {
        match: body?.match,
        bet: body?.bet,
        item: body?.item,
      },
    });
    const pendingRow = {
      orderId: pfOrderHash,
      provider: "PredictFun",
      match: labels.match,
      bet: labels.bet,
      item: labels.item,
      odds: bookOdds,
      betMoney: stake,
      money: 0,
      status: "Pending",
      createAt: Date.now(),
      pfMarketId: marketId,
      pfTokenId: tokenId,
      pfBookPrice: bookPrice > 0 ? bookPrice : undefined,
      pfNotionalUsdt: stake,
      pfOrderHash,
      pfSide: "buy",
      pfSellState: "open",
      pfFeeRateBps: Number(body?.feeRateBps) >= 0 ? Number(body.feeRateBps) : undefined,
      pfUserSigned: true,
    };
    const savedPending = await upsertPfServerOrder(gate.playerId, [pendingRow], userId);
    if (!savedPending)
      return { ok: false, msg: "落库失败，未向官网提交订单" };

    let result;
    try {
      result = await predictFunPost("/v1/orders", createOrderBody, jwt);
    }
    catch (postErr) {
      // Pending 已在库：GetOrder 可按 hash 对齐；勿当「从未下单」
      const hint = postErr instanceof Error ? postErr.message : String(postErr);
      return {
        ok: false,
        msg: `官网提交异常，订单已落库待确认（orderHash=${pfOrderHash}）：${hint}`.slice(0, 200),
        info: { orderId: pfOrderHash, pfOrderHash, pending: true },
      };
    }

    if (!isPredictFunOrderAccepted(result)) {
      const code = String(result?.data?.code ?? "").trim();
      try {
        await upsertPfServerOrder(gate.playerId, [{
          ...pendingRow,
          status: "reject",
          pfOfficialStatus: code || "rejected",
        }], userId);
      }
      catch (rejectErr) {
        console.warn("[Pf_SubmitOrder] reject persist failed", pfOrderHash, rejectErr);
      }
      return {
        ok: false,
        msg: code
          ? `Predict.fun 下单未受理（code: ${code}）`
          : "Predict.fun 下单未受理",
      };
    }

    const pfApiOrderId = String(result?.data?.orderId ?? "").trim();
    if (pfApiOrderId) {
      const savedApi = await upsertPfServerOrder(gate.playerId, [{
        ...pendingRow,
        pfApiOrderId,
      }], userId);
      if (!savedApi) {
        // 官网已受理且 Pending 已在库；apiId 可随后 GetOrder 补齐
        console.warn("[Pf_SubmitOrder] pfApiOrderId persist failed", pfOrderHash, pfApiOrderId);
      }
    }

    return {
      ok: true,
      info: {
        orderId: pfOrderHash,
        code: result?.data?.code ?? "accepted",
        bookPrice,
        bookOdds,
        playerId: gate.playerId,
        pending: true,
      },
    };
  }
  catch (err) {
    return { ok: false, msg: err instanceof Error ? err.message : String(err) };
  }
}

/** Pf_SettleOpenOrders — 主动结算已 RESOLVED 市场的未结单 */
export async function handlePfSettleOpenOrders(body, userId) {
  const gate = await assertPfPlayer(body, userId);
  if (!gate.ok)
    return gate;
  try {
    const stats = await settleResolvedPfOrdersForPlayer(gate.playerId, userId);
    const owned = await assertPlayerOwnedByUser(gate.playerId, userId);
    const player = owned.ok ? owned.player : gate.player;
    const balance = await resolvePfBalance(player, userId, gate.playerId);
    const published = await publishPfBalanceKnown(gate.playerId, userId, balance);
    return {
      ok: true,
      info: {
        ...stats,
        balance: published.ok ? published.info.balance : balance,
        totalProfit: published.ok ? published.info.totalProfit : undefined,
        unsettle: published.ok ? published.info.unsettle : undefined,
        playerId: gate.playerId,
      },
    };
  }
  catch (err) {
    return { ok: false, msg: err instanceof Error ? err.message : String(err) };
  }
}

/** Pf_GetOrder — 对齐本人 RDS 订单后返回 changmen 处理结果（不含官网原文） */
export async function handlePfGetOrder(body, userId) {
  const gate = await assertPfPlayer(body, userId);
  if (!gate.ok)
    return gate;

  const orderId = String(body?.orderId ?? body?.hash ?? "").trim();
  if (!orderId)
    return { ok: false, msg: "orderId 必填" };

  try {
    try {
      await retryPendingPfLedgerCredits(gate.playerId, userId);
    }
    catch (err) {
      console.warn("[Pf_GetOrder] pending credit retry skipped", err);
    }

    const list = await loadPfOrdersStrict(gate.playerId, userId);
    const rdsRow = findPfOrderInList(list, orderId);
    if (!rdsRow)
      return { ok: false, msg: "订单不存在或不属于当前账号" };

    const aligned = await alignPfOrderWithOfficial(
      gate.playerId,
      userId,
      rdsRow,
      String(body?.jwt ?? "").trim(),
    );

    return {
      ok: true,
      info: toUserPfGetOrderInfo({
        orderId: aligned.venueOrder.orderId || orderId,
        found: aligned.found,
        settlement: aligned.settlement,
        order: aligned.venueOrder,
        refunded: aligned.refunded,
      }),
    };
  }
  catch (err) {
    return { ok: false, msg: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Pf_GetOrders — 对本玩家 RDS 订单逐条按 hash 对齐官方状态
 * 官方列表 filter 仅 OPEN/FILLED，故未结单须逐条 Get-by-hash。
 */
export async function handlePfGetOrders(body, userId) {
  const gate = await assertPfPlayer(body, userId);
  if (!gate.ok)
    return gate;

  const jwt = String(body?.jwt ?? "").trim();

  try {
    const list = await loadPfOrdersStrict(gate.playerId, userId);
    const orders = [];
    let refundedCount = 0;

    for (const rdsRow of list) {
      const hash = rdsPfHash(rdsRow);
      if (!hash) {
        orders.push(mapPredictOrderToVenueOrder(null, rdsToMapInput(rdsRow)));
        continue;
      }

      const st = String(rdsOrderStatus(rdsRow)).toLowerCase();
      if (st === "win" || st === "lose" || st === "reject" || st === "return") {
        orders.push(mapPredictOrderToVenueOrder(null, rdsToMapInput(rdsRow)));
        continue;
      }

      try {
        const aligned = await alignPfOrderWithOfficial(gate.playerId, userId, rdsRow, jwt);
        if (aligned.refunded)
          refundedCount += 1;
        orders.push(aligned.venueOrder);
      }
      catch (err) {
        console.warn("[Pf_GetOrders] hash lookup failed", hash, err);
        orders.push(mapPredictOrderToVenueOrder(null, rdsToMapInput(rdsRow)));
      }
    }

    orders.sort((a, b) => (Number(b.createAt) || 0) - (Number(a.createAt) || 0));

    let settleStats = { settled: 0, wins: 0, losses: 0 };
    try {
      settleStats = await settleResolvedPfOrdersForPlayer(gate.playerId, userId);
      if (settleStats.settled > 0) {
        const refreshed = await loadPfOrdersStrict(gate.playerId, userId);
        orders.length = 0;
        for (const rdsRow of refreshed) {
          orders.push(mapPredictOrderToVenueOrder(null, rdsToMapInput(rdsRow)));
        }
        orders.sort((a, b) => (Number(b.createAt) || 0) - (Number(a.createAt) || 0));
      }
    }
    catch (err) {
      console.warn("[Pf_GetOrders] settle skipped", err);
    }

    return {
      ok: true,
      info: {
        orders: toUserPfVenueOrders(orders),
        refundedCount,
        settledCount: settleStats.settled,
        playerId: gate.playerId,
      },
    };
  }
  catch (err) {
    return { ok: false, msg: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Pf_SubmitSell — 浏览器已签 MARKET FOK 卖出中继。
 * body.mode === "userSigned"：jwt + createOrderBody（或 resume_closing 仅 jwt）。
 */
export async function handlePfSubmitSell(body, userId) {
  const mode = String(body?.mode ?? "").trim();
  if (mode !== "userSigned")
    return { ok: false, msg: PF_MEMBERSHIP_REMOVED_MSG };

  const gate = await assertPfPlayer(body, userId);
  if (!gate.ok)
    return gate;

  const buyOrderId = String(body?.buyOrderId ?? "").trim();
  if (!buyOrderId)
    return { ok: false, msg: "buyOrderId 必填" };

  try {
    const info = await executePfUserSignedSell({
      playerId: gate.playerId,
      userId,
      buyOrderId,
      jwt: String(body?.jwt ?? "").trim(),
      createOrderBody: parseEsportJsonField(body?.createOrderBody),
      orderHash: body?.orderHash,
      bookPrice: body?.bookPrice,
      bookOdds: body?.bookOdds,
      proceedsUsdt: body?.proceedsUsdt,
    });
    return { ok: true, info };
  }
  catch (err) {
    return { ok: false, msg: err instanceof Error ? err.message : String(err) };
  }
}

export async function handlePfHouseRedeemResolved(_body, _userId) {
  return { ok: false, msg: PF_MEMBERSHIP_REMOVED_MSG };
}

/**
 * Pf_RecoverStuckOrders — 列出或补偿 pending_credit / closing
 * body: { playerId, dryRun?: boolean }
 */
export async function handlePfRecoverStuckOrders(body, userId) {
  const dryRun = Boolean(body?.dryRun);
  const gate = await assertPfPlayer(body, userId);
  if (!gate.ok)
    return gate;
  try {
    if (dryRun) {
      const listed = await listPfStuckOrdersForPlayer(gate.playerId, userId);
      return {
        ok: true,
        info: {
          dryRun: true,
          playerId: gate.playerId,
          ...listed,
        },
      };
    }
    return { ok: false, msg: PF_MEMBERSHIP_REMOVED_MSG };
  }
  catch (err) {
    return { ok: false, msg: err instanceof Error ? err.message : String(err) };
  }
}
