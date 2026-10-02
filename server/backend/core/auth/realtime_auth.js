import * as db from "@changmen/db";
import { loadProfileById } from "../db/store.js";
import { readClientCertStatus, clientCertCnFromSubject, clientCertificateAudit } from "../shared/client_cert_gate.js";
import { readBrowserSessionCookie } from "./browser_session.js";
import { validAuthOrigin } from "./web_session_security.js";
import { authenticateIdentity } from "./identity.js";
import { isAdminUser } from "./admin_auth.js";

export async function authenticateRealtime(socket) {
  if (!validAuthOrigin(socket.request))
    return { code: "ORIGIN_INVALID" };
  const token = String(socket.handshake.auth?.token || socket.handshake.headers.token || "");
  const cookie = readBrowserSessionCookie(socket.request);
  const audit = { ...clientCertificateAudit(socket.request) };
  const auth = await authenticateIdentity({ token, browserSessionToken: cookie,
    protocol: socket.handshake.auth?.protocol, audit, fresh: true }, db);
  if (auth.code)
    return { code: auth.code };
  const user = await loadProfileById(auth.userId);
  return user ? { user, identity: auth } : { code: "TEMPORARY_UNAVAILABLE" };
}

const replies = new Map();
function admin(user) { return isAdminUser(user); }
async function canOperate(user, targetId) {
  const target = await loadProfileById(targetId);
  return Boolean(target && (admin(user) || user.role === "leader" && user.teamId && user.teamId === target.teamId));
}

/** Never allow arbitrary channel names or arbitrary publication into user-command rooms. */
export async function authorizeRealtime(socket, channel, operation, message) {
  const auth = await authenticateRealtime(socket);
  if (!auth.user)
    return false;
  socket.data.userId = auth.user.id;
  const user = auth.user;
  if (["Polymarket:PmSport", "Polymarket:Maintenance"].includes(channel))
    return operation === "subscribe";
  if (channel === "BetTarget")
    return operation === "subscribe" || user.setting?.BetTarget === true || user.setting?.BetTarget === 1;
  if (channel === "Publish")
    return operation === "subscribe" || user.setting?.Publisher === true || user.setting?.Publisher === 1;
  if (channel.startsWith("USER:")) {
    const target = channel.slice(5);
    if (operation === "subscribe")
      return String(user.id) === target;
    if (!await canOperate(user, target))
      return false;
    let data;
    try { data = JSON.parse(message); }
    catch { return false; }
    if (!["account", "upload", "query"].includes(data.action))
      return false;
    if (data.action === "query") {
      const info = data.info;
      if (info?.reply !== `TRADE:${user.id}` || typeof info.msgId !== "string" || info.msgId.length > 128)
        return false;
      const now = Date.now();
      for (const [key, grant] of replies) if (grant.expiresAt <= now) replies.delete(key);
      if (replies.size >= 1000)
        return false;
      replies.set(`${info.reply}:${info.msgId}`, { source: target, expiresAt: now + 30_000 });
    }
    return true;
  }
  if (channel.startsWith("TRADE:")) {
    if (operation === "subscribe")
      return channel === `TRADE:${user.id}` && (admin(user) || user.role === "leader");
    let data;
    try { data = JSON.parse(message); }
    catch { return false; }
    const key = `${channel}:${data.msgId}`;
    const grant = replies.get(key);
    if (!grant || grant.source !== String(user.id) || grant.expiresAt <= Date.now())
      return false;
    if (!await canOperate(await loadProfileById(channel.slice(6)) || {}, user.id))
      return false;
    replies.delete(key);
    return true;
  }
  return false;
}
