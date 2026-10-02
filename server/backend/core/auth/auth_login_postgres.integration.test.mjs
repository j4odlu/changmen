import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Explicit disposable local database only. Never infer this URL from backend .env.
const testUrl = process.env.AUTH_TEST_DATABASE_URL;
const enabled = Boolean(testUrl);
if (enabled) {
  const url = new URL(testUrl);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/changmen_auth_test")
    throw new Error("AUTH_TEST_DATABASE_URL must target disposable localhost changmen_auth_test");
}
const saved = { ...process.env };
let certificates;
let pool, auth;
const userId = "153f91c6-ce36-4014-8f9b-3612bbe4c0d1";
const oldId = "8f13916f-262e-43f9-9e7b-b825920b8a12";
const oldRefreshId = "8f13916f-262e-43f9-9e7b-b825920b8a13";
const oldSecret = "x".repeat(43);
const oldCookie = `bs1.${oldId}.${oldSecret}`;
const tables = ["users", "profiles", "auth_sessions", "auth_refresh_tokens"];
describe.skipIf(!enabled)("real PostgreSQL login isolation", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testUrl;
    process.env.DATABASE_SSL = "0";
    process.env.JWT_SECRET = "disposable-pg-test-secret-at-least-32-bytes";
    const pg = await import("../../../db/pg_pool.js");
    pool = pg.getPgPool();
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY, user_name text NOT NULL, password_hash text NOT NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at bigint NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS profiles (id uuid PRIMARY KEY REFERENCES users(id), user_name text NOT NULL,
        accounts jsonb, betting_config jsonb, collect_config jsonb, preferences jsonb, created_at bigint, updated_at bigint);`);
    for (const file of ["043_auth_session_audit.sql", "044_auth_sessions.sql"])
      await pool.query(await readFile(new URL(`../../db/migrations/${file}`, import.meta.url), "utf8"));
    await pool.query("CREATE OR REPLACE FUNCTION auth_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$");
    await pool.query(await readFile(new URL("../../../db/schema/client_certificates.sql", import.meta.url), "utf8"));
    certificates = await import("../../../db/rds/client_certificate_store.js");
    auth = await import("../../../db/rds/auth_store.js");
  });
  beforeEach(async () => {
    process.env.CLIENT_CERT_REGISTRY_ENABLED = "0";
    for (const table of tables)
      await pool.query(`DROP TRIGGER IF EXISTS auth_test_fault ON ${table}`);
    await pool.query("TRUNCATE client_certificate_audit, client_certificates, auth_session_audit, auth_refresh_tokens, auth_sessions, profiles, users");
    await pool.query("INSERT INTO users (id, user_name, password_hash, metadata) VALUES ($1, 'river', crypt('password', gen_salt('bf', 12)), '{\"active_session_id\":\"old-login\"}')", [userId]);
    await pool.query("INSERT INTO profiles (id, user_name) VALUES ($1, 'river')", [userId]);
    const now = Date.now();
    await pool.query(`INSERT INTO auth_sessions (id, user_id, jwt_session_id, secret_hash, created_at,
      last_seen_at, idle_expires_at, absolute_expires_at) VALUES ($1, $2, 'old-login', $3, $4, $4, $5, $5)`,
      [oldId, userId, crypto.createHash("sha256").update(oldSecret).digest("hex"), now, now + 60_000]);
    await pool.query(`INSERT INTO auth_refresh_tokens (id, family_id, user_id, session_id, secret_hash, created_at, expires_at)
      VALUES ($1, $1, $2, 'old-login', $3, $4, $5)`, [oldRefreshId, userId, "old-hash", now, now + 60_000]);
  });
  afterAll(async () => { await pool?.end(); process.env = { ...saved }; });
  it.each(["users", "auth_sessions", "auth_refresh_tokens"])("rolls back every logout write when %s fails", async table => {
    await pool.query(`CREATE TRIGGER auth_test_fault BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION auth_test_fail()`);
    expect(await auth.authSignOutBrowserSession({ id: oldId, userId, jwtSessionId: "old-login" })).toEqual({ temporary: true });
    await pool.query(`DROP TRIGGER auth_test_fault ON ${table}`);
    expect(await auth.authResolveBrowserSession(oldCookie)).toHaveProperty("userId", userId);
    const refresh = await pool.query("SELECT revoked_at FROM auth_refresh_tokens WHERE id = $1", [oldRefreshId]);
    expect(refresh.rows[0].revoked_at).toBeNull();
  });
  it("revokes Cookie and refresh credentials together without JWT issuance", async () => {
    expect(await auth.authSignOutBrowserSession({ id: oldId, userId, jwtSessionId: "old-login" })).toEqual({ ok: true });
    expect(await auth.authResolveBrowserSession(oldCookie)).toHaveProperty("revoked", true);
    const refresh = await pool.query("SELECT revoked_at FROM auth_refresh_tokens WHERE id = $1", [oldRefreshId]);
    expect(refresh.rows[0].revoked_at).not.toBeNull();
  });
  it("cannot revoke a new login with the previous login epoch", async () => {
    const login = await auth.authSignIn("river", "password", {}, { browserSession: true });
    expect(await auth.authSignOutBrowserSession({ id: oldId, userId, jwtSessionId: "old-login" })).toEqual({ conflict: true });
    expect(await auth.authResolveBrowserSession(login.browserSession.token)).toHaveProperty("userId", userId);
  });
  it.each([
    ["profiles", "INSERT"], ["auth_refresh_tokens", "INSERT"], ["auth_refresh_tokens", "UPDATE"],
    ["auth_sessions", "UPDATE"], ["auth_sessions", "INSERT"], ["users", "UPDATE"],
  ])("leaves the old login usable if %s %s fails", async (table, operation) => {
    await pool.query(`CREATE TRIGGER auth_test_fault BEFORE ${operation} ON ${table} FOR EACH ROW EXECUTE FUNCTION auth_test_fail()`);
    const login = await auth.authSignIn("river", "password", {}, { browserSession: true });
    expect(login.error).toBe("db");
    const users = await pool.query("SELECT metadata->>'active_session_id' AS epoch FROM users WHERE id = $1", [userId]);
    const sessions = await pool.query("SELECT id, revoked_at FROM auth_sessions WHERE user_id = $1", [userId]);
    const refresh = await pool.query("SELECT id, revoked_at FROM auth_refresh_tokens WHERE user_id = $1", [userId]);
    expect(users.rows[0].epoch).toBe("old-login");
    expect(sessions.rows).toEqual([{ id: oldId, revoked_at: null }]);
    expect(refresh.rows).toEqual([{ id: oldRefreshId, revoked_at: null }]);
    await pool.query(`DROP TRIGGER auth_test_fault ON ${table}`);
    expect(await auth.authResolveBrowserSession(oldCookie)).toHaveProperty("userId", userId);
  });
  it("serializes simultaneous logins and leaves exactly one current Cookie session", async () => {
    const logins = await Promise.all([
      auth.authSignIn("river", "password", {}, { browserSession: true }),
      auth.authSignIn("river", "password", {}, { browserSession: true }),
    ]);
    expect(logins.every(login => login.browserSession?.token)).toBe(true);
    const active = await pool.query("SELECT jwt_session_id FROM auth_sessions WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
    expect(active.rows).toHaveLength(1);
    const user = await pool.query("SELECT metadata->>'active_session_id' AS epoch FROM users WHERE id = $1", [userId]);
    expect(active.rows[0].jwt_session_id).toBe(user.rows[0].epoch);
    const resolved = await Promise.all(logins.map(login => auth.authResolveBrowserSession(login.browserSession.token)));
    expect(resolved.filter(session => session?.userId && !session.revoked && !session.invalid)).toHaveLength(1);
  });
  it("preserves legacy sessions, binds fingerprints to immutable users, and revokes all certificate credentials", async () => {
    process.env.CLIENT_CERT_REGISTRY_ENABLED = "1";
    process.env.CLIENT_CERT_LEGACY_ENABLED = "1";
    const fp = "a".repeat(64), otherFp = "b".repeat(64);
    const audit = { certCn: "river", certFingerprint: fp };
    // Existing sessions predate the fingerprint column and continue to work.
    await pool.query("UPDATE auth_sessions SET cert_cn='river' WHERE id=$1",[oldId]);
    expect(await auth.authResolveBrowserSession(oldCookie,audit)).toHaveProperty("userId",userId);
    await certificates.registerClientCertificate({fingerprint:fp,userId,serial:"01",cn:"river",pem:"public-test-certificate",notBefore:Date.now()-1000,expiresAt:Date.now()+86400000},userId);
    await expect(certificates.registerClientCertificate({fingerprint:fp,userId:crypto.randomUUID(),serial:"02",cn:"other",pem:"public",notBefore:0,expiresAt:Date.now()+1000},userId)).rejects.toHaveProperty("status",409);
    await pool.query("UPDATE users SET user_name='renamed' WHERE id=$1",[userId]);
    expect(await certificates.authorizeClientCertificate(audit,userId)).toBeNull();
    expect(await certificates.authorizeClientCertificate(audit,crypto.randomUUID())).toBe("CERT_BIND_FAILED");
    const login = await auth.authSignIn("renamed","password",audit,{browserSession:true});
    expect(login.browserSession.token).toBeTruthy();
    expect(await auth.authResolveBrowserSession(login.browserSession.token,audit)).toHaveProperty("userId",userId);
    expect(await auth.authResolveBrowserSession(login.browserSession.token,{...audit,certFingerprint:otherFp})).toHaveProperty("invalid",true);
    const rotated = await auth.authRefreshToken(login.refreshToken,audit);
    expect(rotated.accessToken).toBeTruthy();
    await certificates.revokeClientCertificate(fp,userId,"integration test");
    expect(await certificates.authorizeClientCertificate(audit,userId)).toBe("CERT_BIND_FAILED");
    expect(await auth.authResolveBrowserSession(login.browserSession.token,audit)).toHaveProperty("revoked",true);
    const remaining=await pool.query("SELECT count(*)::int AS n FROM auth_refresh_tokens WHERE user_id=$1 AND revoked_at IS NULL",[userId]);
    expect(remaining.rows[0].n).toBe(0);
  });

});
