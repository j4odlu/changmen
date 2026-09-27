import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const poolQuery = vi.fn();
  const clientQuery = vi.fn();
  const release = vi.fn();
  return {
    poolAvailable: true,
    poolQuery,
    clientQuery,
    release,
    pool: {
      query: poolQuery,
      connect: vi.fn(async () => ({ query: clientQuery, release })),
    },
  };
});

vi.mock("../../../db/rds/common.js", () => ({ getPgPool: () => mocks.poolAvailable ? mocks.pool : null }));

const originalSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = "rotation-test-secret-at-least-32-bytes";

const { getBrowserSession, issueOpaqueRefreshToken, rotateOpaqueRefreshToken } = await import(
  "../../../db/rds/auth_session_store.js"
);

afterAll(() => {
  if (originalSecret === undefined)
    delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

beforeEach(() => {
  mocks.poolAvailable = true;
  mocks.poolQuery.mockReset();
  mocks.clientQuery.mockReset();
  mocks.release.mockReset();
});

describe("opaque refresh rotation", () => {
  it("reports database outages as temporary instead of invalidating sessions", async () => {
    mocks.poolAvailable = false;
    const secret = "x".repeat(43);
    await expect(rotateOpaqueRefreshToken(`rt1.8f13916f-262e-43f9-9e7b-b825920b8a12.${secret}`)).resolves.toEqual({ temporary: true });
    await expect(getBrowserSession(`bs1.8f13916f-262e-43f9-9e7b-b825920b8a12.${secret}`)).resolves.toEqual({ temporary: true });
  });

  it("returns the same replacement during the short response-loss retry window", async () => {
    mocks.poolQuery.mockResolvedValue({ rowCount: 1 });
    const issued = await issueOpaqueRefreshToken("user-1", "session-1", {});
    const initialInsert = mocks.poolQuery.mock.calls[0][1];
    const initialId = initialInsert[0];
    const familyId = initialInsert[1];
    const initialHash = initialInsert[4];

    mocks.clientQuery.mockImplementation(async (sql) => {
      if (String(sql).includes("SELECT id, family_id")) {
        return {
          rows: [{
            id: initialId,
            family_id: familyId,
            user_id: "user-1",
            session_id: "session-1",
            secret_hash: initialHash,
            cert_cn: "",
            expires_at: Date.now() + 60_000,
            used_at: null,
            revoked_at: null,
            replaced_by_id: null,
          }],
        };
      }
      return { rowCount: 1, rows: [] };
    });

    const first = await rotateOpaqueRefreshToken(issued.token, {});
    expect(first.refreshToken).toMatch(/^rt1\./);
    const replacementId = first.refreshToken.split(".")[1];
    const replacementInsert = mocks.clientQuery.mock.calls.find(
      ([sql, values]) => String(sql).includes("INSERT INTO auth_refresh_tokens") && values?.[0] === replacementId,
    );
    const replacementHash = replacementInsert[1][4];

    mocks.clientQuery.mockImplementation(async (sql) => {
      if (String(sql).includes("SELECT id, family_id")) {
        return {
          rows: [{
            id: initialId,
            family_id: familyId,
            user_id: "user-1",
            session_id: "session-1",
            secret_hash: initialHash,
            cert_cn: "",
            expires_at: Date.now() + 60_000,
            used_at: Date.now() - 1_000,
            revoked_at: null,
            replaced_by_id: replacementId,
          }],
        };
      }
      if (String(sql).includes("SELECT secret_hash")) {
        return {
          rows: [{
            secret_hash: replacementHash,
            expires_at: Date.now() + 60_000,
            used_at: null,
            revoked_at: null,
          }],
        };
      }
      return { rowCount: 1, rows: [] };
    });

    const retry = await rotateOpaqueRefreshToken(issued.token, {});
    expect(retry).toMatchObject({ retried: true, refreshToken: first.refreshToken });
    expect(mocks.release).toHaveBeenCalledTimes(2);
  });

  it("revokes the token family after the replacement token has already been used", async () => {
    mocks.poolQuery.mockResolvedValue({ rowCount: 1 });
    const issued = await issueOpaqueRefreshToken("user-1", "session-1", {});
    const params = mocks.poolQuery.mock.calls[0][1];
    mocks.clientQuery.mockImplementation(async (sql) => {
      if (String(sql).includes("SELECT id, family_id")) {
        return {
          rows: [{
            id: params[0],
            family_id: params[1],
            user_id: "user-1",
            session_id: "session-1",
            secret_hash: params[4],
            cert_cn: "",
            expires_at: Date.now() + 60_000,
            used_at: Date.now() - 1_000,
            revoked_at: null,
            replaced_by_id: "8f13916f-262e-43f9-9e7b-b825920b8a12",
          }],
        };
      }
      if (String(sql).includes("SELECT secret_hash")) {
        return {
          rows: [{
            secret_hash: "00".repeat(32),
            expires_at: Date.now() + 60_000,
            used_at: Date.now() - 500,
            revoked_at: null,
          }],
        };
      }
      return { rowCount: 1, rows: [] };
    });

    await expect(rotateOpaqueRefreshToken(issued.token, {})).resolves.toMatchObject({
      replayed: true,
      revoked: true,
    });
  });
});
