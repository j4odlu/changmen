/**
 * 管理端「订单和用户维护」只读诊断：共用投注账号、order_id 重复。
 */
import { ensurePgPoolReady, financialOrdersRelation, getPgPool } from "@changmen/db";

function dayKeyShanghai(ms) {
  const n = Number(ms) || 0;
  if (!n)
    return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(n));
}

function suggestSharedVenue(group) {
  const activeUsers = group.activeUsers || [];
  const users = group.users || [];
  if (activeUsers.length > 1) {
    return `两边都还活跃：立刻只留一个用户继续使用该场馆账号，另一侧删除活跃卡，并清理非主人侧的撞车订单。建议主人：${activeUsers.join(" / ")} 中择一。`;
  }
  if (activeUsers.length === 1) {
    const owner = activeUsers[0];
    const others = users.filter(u => u !== owner);
    return `现仅 ${owner} 活跃。建议：确认归属归 ${owner}；${others.join("、") || "其他用户"} 侧已删账号不要再加回；若有跨用户同 order_id 订单，删非 ${owner} 侧副本。`;
  }
  return `当前无活跃占用（均已软删）。venue_account_key 含已删互斥：仅原主人可通过「添加账号」复活；他人抢加会被拒绝。`;
}

function suggestOrderDup(group) {
  if (group.kind === "same_user") {
    return `同用户多行同 order_id（多 player_id）。建议：保留较新写入或非 Reject 的一行，删除其余重复行；并检查是否删号重加导致。`;
  }
  const names = (group.users || []).join(" + ");
  return `跨用户共用场馆单号（${names}）。建议：按场馆账号现归属只保留主人用户订单，删除另一用户同 order_id 副本；同时拆开共用投注账号，避免继续双记。`;
}

/** 跨用户（含软删）共用同一 venue_account_key */
export async function listSharedVenueAccounts() {
  await ensurePgPoolReady();
  const pool = getPgPool();
  if (!pool)
    throw new Error("数据库未就绪");

  const { rows } = await pool.query(`
    WITH multi AS (
      SELECT venue_account_key
      FROM players
      WHERE venue_account_key <> ''
      GROUP BY venue_account_key
      HAVING COUNT(DISTINCT owner_user_id) > 1
    )
    SELECT
      p.venue_account_key AS key,
      p.provider,
      p.venue_member_id,
      p.id AS player_id,
      pr.user_name,
      p.owner_user_id::text AS user_id,
      p.platform_name,
      p.player_name,
      COALESCE(p.account_data->>'venueAccountName', '') AS venue_account_name,
      (p.deleted_at IS NOT NULL) AS deleted,
      p.created_at,
      p.deleted_at,
      (SELECT COUNT(*)::int FROM ${financialOrdersRelation("o")} WHERE o.player_id = p.id) AS order_count
    FROM players p
    JOIN profiles pr ON pr.id = p.owner_user_id
    JOIN multi m ON m.venue_account_key = p.venue_account_key
    ORDER BY p.venue_account_key, p.deleted_at NULLS FIRST, pr.user_name, p.id
  `);

  const byKey = new Map();
  for (const r of rows || []) {
    const key = String(r.key || "");
    if (!byKey.has(key)) {
      byKey.set(key, {
        venueAccountKey: key,
        provider: String(r.provider || ""),
        venueMemberId: String(r.venue_member_id || ""),
        users: [],
        activeUsers: [],
        bothActive: false,
        players: [],
        suggestion: "",
      });
    }
    const g = byKey.get(key);
    const userName = String(r.user_name || "");
    const deleted = Boolean(r.deleted);
    g.players.push({
      playerId: Number(r.player_id) || 0,
      userId: String(r.user_id || ""),
      userName,
      platformName: String(r.platform_name || ""),
      playerName: String(r.player_name || ""),
      venueMemberId: String(r.venue_member_id || ""),
      venueAccountName: String(r.venue_account_name || "").trim() || undefined,
      deleted,
      createdAt: Number(r.created_at) || 0,
      deletedAt: r.deleted_at != null ? Number(r.deleted_at) : null,
      orderCount: Number(r.order_count) || 0,
    });
  }

  const list = [];
  for (const g of byKey.values()) {
    g.users = [...new Set(g.players.map(p => p.userName))].sort((a, b) => a.localeCompare(b, "zh"));
    g.activeUsers = [...new Set(g.players.filter(p => !p.deleted).map(p => p.userName))]
      .sort((a, b) => a.localeCompare(b, "zh"));
    g.bothActive = g.activeUsers.length > 1;
    g.suggestion = suggestSharedVenue(g);
    list.push(g);
  }
  list.sort((a, b) => {
    if (a.bothActive !== b.bothActive)
      return a.bothActive ? -1 : 1;
    return a.users.join(",").localeCompare(b.users.join(","), "zh")
      || a.venueAccountKey.localeCompare(b.venueAccountKey);
  });

  return {
    generatedAt: Date.now(),
    total: list.length,
    bothActive: list.filter(g => g.bothActive).length,
    list,
  };
}

/**
 * order_id 重复：
 * - same_user：同用户多行
 * - cross_user：跨用户
 */
export async function listDuplicateOrderIds() {
  await ensurePgPoolReady();
  const pool = getPgPool();
  if (!pool)
    throw new Error("数据库未就绪");

  const sameUser = await pool.query(`
    SELECT lower(o.order_id) AS oid,
           o.user_id::text AS user_id,
           pr.user_name,
           COUNT(*)::int AS n,
           array_agg(o.id ORDER BY o.id) AS ids,
           array_agg(o.player_id::text ORDER BY o.id) AS player_ids,
           array_agg(o.provider ORDER BY o.id) AS providers,
           array_agg(o.status ORDER BY o.id) AS statuses,
           array_agg(o.money ORDER BY o.id) AS moneys,
           MIN(o.create_at) AS min_at,
           MAX(o.create_at) AS max_at
    FROM ${financialOrdersRelation("o")}
    LEFT JOIN profiles pr ON pr.id = o.user_id
    WHERE o.order_id IS NOT NULL AND trim(o.order_id) <> ''
    GROUP BY lower(o.order_id), o.user_id, pr.user_name
    HAVING COUNT(*) > 1
    ORDER BY MAX(o.create_at) DESC
    LIMIT 500
  `);

  const crossUser = await pool.query(`
    SELECT lower(o.order_id) AS oid,
           COUNT(*)::int AS n,
           COUNT(DISTINCT o.user_id)::int AS user_n,
           array_agg(DISTINCT pr.user_name ORDER BY pr.user_name) AS names,
           array_agg(o.id ORDER BY o.id) AS ids,
           array_agg(o.user_id::text ORDER BY o.id) AS user_ids,
           array_agg(pr.user_name ORDER BY o.id) AS user_names,
           array_agg(o.player_id::text ORDER BY o.id) AS player_ids,
           array_agg(o.provider ORDER BY o.id) AS providers,
           array_agg(o.status ORDER BY o.id) AS statuses,
           array_agg(o.money ORDER BY o.id) AS moneys,
           MIN(o.create_at) AS min_at,
           MAX(o.create_at) AS max_at
    FROM ${financialOrdersRelation("o")}
    LEFT JOIN profiles pr ON pr.id = o.user_id
    WHERE o.order_id IS NOT NULL AND trim(o.order_id) <> ''
    GROUP BY lower(o.order_id)
    HAVING COUNT(DISTINCT o.user_id) > 1
    ORDER BY MAX(o.create_at) DESC
    LIMIT 500
  `);

  const mapSame = (sameUser.rows || []).map((r) => {
    const group = {
      kind: "same_user",
      orderId: String(r.oid || ""),
      users: [String(r.user_name || r.user_id || "")],
      userIds: [String(r.user_id || "")],
      count: Number(r.n) || 0,
      day: dayKeyShanghai(r.min_at),
      createAt: Number(r.min_at) || 0,
      rows: (r.ids || []).map((id, i) => ({
        id: Number(id) || 0,
        userId: String(r.user_id || ""),
        userName: String(r.user_name || ""),
        playerId: Number(r.player_ids?.[i]) || 0,
        provider: String(r.providers?.[i] || ""),
        status: String(r.statuses?.[i] || ""),
        money: Number(r.moneys?.[i]) || 0,
      })),
      suggestion: "",
    };
    group.suggestion = suggestOrderDup(group);
    return group;
  });

  const mapCross = (crossUser.rows || []).map((r) => {
    const names = (r.names || []).map(String);
    const group = {
      kind: "cross_user",
      orderId: String(r.oid || ""),
      users: names,
      userIds: [...new Set((r.user_ids || []).map(String))],
      count: Number(r.n) || 0,
      day: dayKeyShanghai(r.min_at),
      createAt: Number(r.min_at) || 0,
      rows: (r.ids || []).map((id, i) => ({
        id: Number(id) || 0,
        userId: String(r.user_ids?.[i] || ""),
        userName: String(r.user_names?.[i] || ""),
        playerId: Number(r.player_ids?.[i]) || 0,
        provider: String(r.providers?.[i] || ""),
        status: String(r.statuses?.[i] || ""),
        money: Number(r.moneys?.[i]) || 0,
      })),
      suggestion: "",
    };
    group.suggestion = suggestOrderDup(group);
    return group;
  });

  const byPair = {};
  for (const g of mapCross) {
    const pair = g.users.join(" + ");
    byPair[pair] = (byPair[pair] || 0) + 1;
  }
  const byDay = {};
  for (const g of [...mapSame, ...mapCross]) {
    const d = g.day || "unknown";
    byDay[d] = (byDay[d] || 0) + 1;
  }

  return {
    generatedAt: Date.now(),
    sameUserTotal: mapSame.length,
    crossUserTotal: mapCross.length,
    byPair,
    byDay,
    sameUser: mapSame,
    crossUser: mapCross,
  };
}

/** 一次拉取两块诊断（管理端首页用） */
export async function getAdminMaintenanceReport() {
  const [sharedVenueAccounts, duplicateOrderIds] = await Promise.all([
    listSharedVenueAccounts(),
    listDuplicateOrderIds(),
  ]);
  const tips = [];
  if (sharedVenueAccounts.bothActive > 0) {
    tips.push(`有 ${sharedVenueAccounts.bothActive} 个场馆账号被多名用户同时活跃占用，请优先处理。`);
  }
  else if (sharedVenueAccounts.total > 0) {
    tips.push(`发现 ${sharedVenueAccounts.total} 个场馆账号曾跨用户使用（含软删），无两边同时活跃。`);
  }
  else {
    tips.push("未发现跨用户共用投注账号。");
  }
  if (duplicateOrderIds.crossUserTotal > 0) {
    tips.push(`跨用户 order_id 重复 ${duplicateOrderIds.crossUserTotal} 组，排行/报表会双计，建议按主人清理副本。`);
  }
  if (duplicateOrderIds.sameUserTotal > 0) {
    tips.push(`同用户 order_id 重复 ${duplicateOrderIds.sameUserTotal} 组，多为删号重加，建议去重。`);
  }
  if (!duplicateOrderIds.crossUserTotal && !duplicateOrderIds.sameUserTotal) {
    tips.push("未发现 order_id 重复。");
  }
  tips.push("含已删 venue_account_key 互斥：删号后他人不可抢加；原主人通过「添加账号」复活同一 player。");

  return {
    generatedAt: Date.now(),
    tips,
    sharedVenueAccounts,
    duplicateOrderIds,
  };
}
