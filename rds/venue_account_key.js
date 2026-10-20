/**
 * 全库场馆操盘账号指纹：禁止跨用户共用同一 venue_member_id 或 gateway+token。
 * 含软删互斥：删号后他人不可抢加；仅原主人可通过「添加账号」复活同一 player。
 * [changmen 扩展] A8 无此约束；changmen 按运营需求全局互斥。
 */

import { createHash } from "node:crypto";

export function normalizeProviderKey(provider) {
  return String(provider ?? "").trim().toLowerCase();
}

export function buildVenueAccountKey({ provider, venueMemberId, gateway, token }) {
  const prov = normalizeProviderKey(provider);
  if (!prov)
    return "";
  const member = String(venueMemberId ?? "").trim();
  if (member)
    return `${prov}:member:${member}`;
  const gw = String(gateway ?? "").trim().replace(/\/+$/, "").toLowerCase();
  const tok = String(token ?? "").trim();
  if (gw && tok) {
    const h = createHash("sha256").update(`${gw}\0${tok}`).digest("hex").slice(0, 32);
    return `${prov}:cred:${h}`;
  }
  return "";
}

export function buildVenueAccountKeyFromRecord(record) {
  const r = record && typeof record === "object" ? record : {};
  return buildVenueAccountKey({
    provider: r.provider ?? r.Provider,
    venueMemberId: r.venueMemberId ?? r.venueId ?? r.VenueMemberId ?? r.VenueId,
    gateway: r.gateway ?? r.Gateway,
    token: r.token ?? r.Token,
  });
}

export class VenueAccountKeyConflictError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "VenueAccountKeyConflictError";
    this.details = details;
  }
}

export function isVenueAccountKeyUniqueViolation(err) {
  if (err?.code !== "23505")
    return false;
  const hint = `${err.constraint || ""} ${err.detail || ""} ${err.message || ""}`;
  return /venue_account_key/i.test(hint);
}

export function venueAccountKeyConflictMessage(conflict) {
  if (!conflict)
    return "该场馆操盘账号已被其他用户使用";
  const who = conflict.userName || conflict.ownerUserId || "其他用户";
  const deleted = conflict.deletedAt != null || conflict.deleted === true;
  if (deleted) {
    return `该场馆操盘账号已被用户 ${who} 占用（已删除，仅原主人可通过添加账号复活；player ${conflict.id}）`;
  }
  return `该场馆操盘账号已被用户 ${who} 占用（player ${conflict.id}）`;
}

/** 本人软删行仍占 fingerprint 时的提示（应走 CreateTagPlatform 复活，勿新建） */
export function ownSoftDeletedVenueAccountMessage(conflict) {
  const id = conflict?.id != null ? `player ${conflict.id}` : "原账号";
  return `你有已删除的同场馆账号（${id}），请用添加账号复活，勿新建`;
}
