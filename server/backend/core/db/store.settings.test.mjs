import { beforeEach, describe, expect, it, vi } from "vitest";

const writeProfileAsync = vi.hoisted(() => vi.fn(async () => {}));
const fetchAccountRecordsByOwnerStrict = vi.hoisted(() => vi.fn(async () => []));
const fetchAccountRecordsByOwner = vi.hoisted(() => vi.fn(async () => []));
const replaceAccountRecordsForOwner = vi.hoisted(() => vi.fn());
const saveAccountRecordsForOwner = vi.hoisted(() => vi.fn(async (_uid, records, options) =>
  options?.replaceWith ? replaceAccountRecordsForOwner(_uid, records, options) : records.length));
const patchPlayerAccountRecord = vi.hoisted(() => vi.fn(async () => null));
const fetchProfileById = vi.hoisted(() => vi.fn(async () => null));

vi.mock("@changmen/db", () => ({
  writeProfileAsync,
  writeProfile: vi.fn(),
  fetchProfileById,
  saveAccountRecordsForOwner,
  fetchAccountRecordsByOwner,
  fetchAccountRecordsByOwnerStrict,
  patchPlayerAccountRecord,
}));

const store = await import("./store.js");

describe("core/db/store setUserSetting 写库可靠化 (P0-2)", () => {
  beforeEach(() => {
    writeProfileAsync.mockReset();
    writeProfileAsync.mockResolvedValue(undefined);
  });

  it("写库成功：内存落新值，且以 await 方式写库", async () => {
    await store.setUserSetting("u1", "CollectConfig", JSON.stringify({ a: 1 }));
    expect(writeProfileAsync).toHaveBeenCalledWith("u1", { collect_config: { a: 1 } });
    expect(JSON.parse(store.getUserSetting("u1", "CollectConfig"))).toEqual({ a: 1 });
  });

  it("写库失败：内存回滚到写前值并抛错（有前值）", async () => {
    await store.setUserSetting("u2", "CollectConfig", JSON.stringify({ a: 1 }));
    writeProfileAsync.mockRejectedValueOnce(new Error("rds down"));
    await expect(
      store.setUserSetting("u2", "CollectConfig", JSON.stringify({ a: 2 })),
    ).rejects.toThrow("rds down");
    // 内存仍为旧值，不会漂移
    expect(JSON.parse(store.getUserSetting("u2", "CollectConfig"))).toEqual({ a: 1 });
  });

  it("写库失败：写前无该行时删除内存脏行并抛错", async () => {
    writeProfileAsync.mockRejectedValueOnce(new Error("rds down"));
    await expect(
      store.setUserSetting("u3", "CollectConfig", JSON.stringify({ a: 1 })),
    ).rejects.toThrow("rds down");
    expect(store.getProfileById("u3")).toBeNull();
    expect(store.getUserSetting("u3", "CollectConfig")).toBeNull();
  });
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("account deletion publication fence", () => {
  beforeEach(() => {
    saveAccountRecordsForOwner.mockReset().mockImplementation(async (_uid, records, options) =>
      options?.replaceWith ? replaceAccountRecordsForOwner(_uid, records, options) : records.length);
    replaceAccountRecordsForOwner.mockReset();
    fetchAccountRecordsByOwner.mockReset();
    fetchAccountRecordsByOwnerStrict.mockReset();
  });

  it.each(["load", "strict", "replace", "save", "patch"])("fences both deleted IDs during %s, then permits a fresh authoritative read", async mode => {
    const uid = `deletion-${mode}`, gate = deferred();
    const rows = [{ accountId: 1 }, { accountId: 2 }, { accountId: 3 }];
    await store.replaceAccountsForUser(uid, rows);
    const source = mode === "load" ? fetchAccountRecordsByOwner
      : mode === "strict" ? fetchAccountRecordsByOwnerStrict
        : mode === "replace" ? saveAccountRecordsForOwner : replaceAccountRecordsForOwner;
    source.mockClear().mockReturnValueOnce(gate.promise);
    const pending = mode === "load" ? store.loadAccountsForUser(uid)
      : mode === "strict" ? store.loadAccountsForUserStrict(uid)
        : mode === "replace" ? store.replaceAccountsForUser(uid, rows.map(row => ({ ...row, token: "new" })))
          : mode === "save" ? store.saveAccountsTransactionForUser(uid, rows, async () => rows)
            : store.updateAccountForUser(uid, 1, { currency: "USDT" });
    await vi.waitFor(() => expect(source).toHaveBeenCalledOnce());
    store.removeAccountForUser(uid, 1);
    store.removeAccountForUser(uid, 2);
    gate.resolve(mode === "replace" ? 3 : rows);
    const result = await pending;
    expect(store.listAccountsForUser(uid).map(row => row.accountId)).toEqual([3]);
    if (mode === "patch") expect(result).toBeNull();
    else expect(result.map(row => row.accountId)).toEqual([3]);
    fetchAccountRecordsByOwnerStrict.mockResolvedValueOnce(rows);
    expect((await store.loadAccountsForUserStrict(uid)).map(row => row.accountId)).toEqual([1, 2, 3]);
  });

  it("records deletion while the cache is empty and clears the fence after a failed operation", async () => {
    const gate = deferred();
    fetchAccountRecordsByOwnerStrict.mockReturnValueOnce(gate.promise);
    const pending = store.loadAccountsForUserStrict("empty-deletion");
    await vi.waitFor(() => expect(fetchAccountRecordsByOwnerStrict).toHaveBeenCalledOnce());
    expect(store.removeAccountForUser("empty-deletion", 7)).toBe(false);
    gate.resolve([{ accountId: 7 }, { accountId: 8 }]);
    expect((await pending).map(row => row.accountId)).toEqual([8]);
    const failureGate = deferred();
    fetchAccountRecordsByOwnerStrict.mockReturnValueOnce(failureGate.promise);
    const failure = store.loadAccountsForUserStrict("empty-deletion");
    const rejected = expect(failure).rejects.toThrow("read failed");
    await vi.waitFor(() => expect(fetchAccountRecordsByOwnerStrict).toHaveBeenCalledTimes(2));
    store.removeAccountForUser("empty-deletion", 8);
    failureGate.reject(new Error("read failed")); await rejected;
    expect(store.listAccountsForUser("empty-deletion")).toEqual([]);
    fetchAccountRecordsByOwnerStrict.mockResolvedValueOnce([{ accountId: 8 }]);
    expect((await store.loadAccountsForUserStrict("empty-deletion"))[0].accountId).toBe(8);
  });
});

describe("balance metadata uses the locked authoritative amount", () => {
  it.each(["OB", "polymarket", "PredictFun"])("preserves %s balance and its profit semantics", async provider => {
    saveAccountRecordsForOwner.mockImplementation(async (_uid, records, options) =>
      options.replaceWith({ existing: [{ accountId: 7, provider, balance: 20, credit: 5 }], players: [] }));
    const row = await store.updateAccountForUser(`balance-${provider}`, 7,
      { balance: 10, Balance: 11, totalBalance: 12, TotalBalance: 13, totalProfit: 3, currency: "USDT" },
      { preserveBalance: true });
    expect(row.balance).toBe(20);
    expect(row.credit).toBe(5);
    expect(row.totalProfit).toBe(provider === "PredictFun" ? 3 : 15);
    expect(row.currency).toBe("USDT");
    expect(row).not.toHaveProperty("Balance");
    expect(row).not.toHaveProperty("totalBalance");
    expect(row).not.toHaveProperty("TotalBalance");
  });
});

describe("commit before cache publication", () => {
  beforeEach(() => {
    writeProfileAsync.mockReset().mockResolvedValue(undefined);
    saveAccountRecordsForOwner.mockReset().mockImplementation(async (_uid, records, options) =>
      options?.replaceWith ? replaceAccountRecordsForOwner(_uid, records, options) : records.length);
    replaceAccountRecordsForOwner.mockReset();
  });

  it("does not publish pending configuration or let a failed write contaminate its successor", async () => {
    await store.updateProfileSetting("serial-profile", { base: 1 });
    const gate = deferred();
    writeProfileAsync.mockReturnValueOnce(gate.promise);
    const first = store.updateProfileSetting("serial-profile", { failed: true });
    const failure = expect(first).rejects.toThrow("injected");
    const second = store.updateProfileSetting("serial-profile", { second: true });
    await vi.waitFor(() => expect(writeProfileAsync).toHaveBeenCalledTimes(2));
    expect(store.getProfileById("serial-profile").setting).toEqual({ base: 1 });
    gate.reject(new Error("injected"));
    await failure;
    await second;
    expect(store.getProfileById("serial-profile").setting).toEqual({ base: 1, second: true });
    expect(writeProfileAsync.mock.calls.at(-1)[1]).toEqual({ betting_config: { base: 1, second: true } });
  });

  it("serializes USERCONFIG with setting patches, and preserves separate preference keys", async () => {
    await Promise.all([
      store.setUserSetting("shared-profile", "USERCONFIG", JSON.stringify({ initial: 1 })),
      store.updateProfileSetting("shared-profile", { appended: 2 }),
      store.setUserSetting("shared-profile", "Follow", "first"),
      store.setUserSetting("shared-profile", "PROXY", "second"),
    ]);
    expect(store.getProfileById("shared-profile").setting).toEqual({ initial: 1, appended: 2 });
    expect(store.getUserSetting("shared-profile", "Follow")).toBe("first");
    expect(store.getUserSetting("shared-profile", "PROXY")).toBe("second");
  });

  it("coordinates an older profile read with subsequent configuration commits", async () => {
    const gate = deferred();
    fetchProfileById.mockReturnValueOnce(gate.promise);
    const loading = store.loadProfileById("profile-read-race");
    await vi.waitFor(() => expect(fetchProfileById).toHaveBeenCalled());
    const writing = store.updateProfileSetting("profile-read-race", { saved: 2 });
    gate.resolve({ id: "profile-read-race", betting_config: { base: 1 } });
    await Promise.all([loading, writing]);
    await store.updateProfileSetting("profile-read-race", { next: 3 });
    expect(store.getProfileById("profile-read-race").setting).toEqual({ base: 1, saved: 2, next: 3 });
  });

  it("does not serialize unrelated users behind a stalled user", async () => {
    const gate = deferred();
    writeProfileAsync.mockReturnValueOnce(gate.promise);
    const first = store.updateProfileSetting("slow-user", { first: true });
    await vi.waitFor(() => expect(writeProfileAsync).toHaveBeenCalledTimes(1));
    await store.updateProfileSetting("other-user", { independent: true });
    expect(store.getProfileById("other-user").setting.independent).toBe(true);
    gate.resolve(); await first;
  });

  it("rejects a zero-row account save and keeps the old cache", async () => {
    await store.replaceAccountsForUser("zero-confirmation", [{ accountId: 7, token: "old" }]);
    saveAccountRecordsForOwner.mockResolvedValueOnce(0);
    await expect(store.replaceAccountsForUser("zero-confirmation", [{ accountId: 7, token: "new" }]))
      .rejects.toThrow("账号保存未全部确认");
    expect(store.listAccountsForUser("zero-confirmation")[0].token).toBe("old");
  });

  it("publishes a full ACCOUNT replacement only when the transaction finishes", async () => {
    await store.replaceAccountsForUser("transaction-cache", [{ accountId: 7, token: "old" }]);
    const gate = deferred();
    replaceAccountRecordsForOwner.mockReturnValueOnce(gate.promise);
    const saving = store.saveAccountsTransactionForUser("transaction-cache", [7], async () => []);
    await vi.waitFor(() => expect(replaceAccountRecordsForOwner).toHaveBeenCalledTimes(1));
    expect(store.listAccountsForUser("transaction-cache")[0].token).toBe("old");
    gate.resolve([{ accountId: 7, token: "committed" }]);
    await saving;
    expect(store.listAccountsForUser("transaction-cache")[0].token).toBe("committed");
    replaceAccountRecordsForOwner.mockRejectedValueOnce(new Error("prune failed"));
    await expect(store.saveAccountsTransactionForUser("transaction-cache", [7], async () => []))
      .rejects.toThrow("prune failed");
    expect(store.listAccountsForUser("transaction-cache")[0].token).toBe("committed");
  });
});

describe("core/db/store updateProfileSetting 写库可靠化 (P0-2)", () => {
  beforeEach(() => {
    writeProfileAsync.mockReset();
    writeProfileAsync.mockResolvedValue(undefined);
  });

  it("写库成功：betting_config 合并并落库，返回最新 profile", async () => {
    const p = await store.updateProfileSetting("b1", { BetTarget: true });
    expect(writeProfileAsync).toHaveBeenCalledWith("b1", { betting_config: { BetTarget: true } });
    expect(p.setting.BetTarget).toBe(true);
  });

  it("写库失败：betting_config 回滚并抛错", async () => {
    await store.updateProfileSetting("b2", { BetTarget: true });
    writeProfileAsync.mockRejectedValueOnce(new Error("rds down"));
    await expect(
      store.updateProfileSetting("b2", { BetTarget: false }),
    ).rejects.toThrow("rds down");
    expect(store.getProfileById("b2").setting.BetTarget).toBe(true);
  });
});

describe("core/db/store prepareAccountsForSave 区分空/失败 (P0-4 D1)", () => {
  beforeEach(() => {
    fetchAccountRecordsByOwnerStrict.mockReset();
    fetchAccountRecordsByOwnerStrict.mockResolvedValue([]);
  });

  it("内存为空 + RDS 读成功：回源并返回账号", async () => {
    fetchAccountRecordsByOwnerStrict.mockResolvedValueOnce([{ accountId: 7 }]);
    const list = await store.prepareAccountsForSave("acc-ok");
    expect(fetchAccountRecordsByOwnerStrict).toHaveBeenCalledWith("acc-ok");
    expect(list.map(a => a.accountId)).toEqual([7]);
  });

  it("内存为空 + RDS 读失败：抛错（供上层中止），不把失败当空账号", async () => {
    fetchAccountRecordsByOwnerStrict.mockRejectedValueOnce(new Error("rds down"));
    await expect(store.prepareAccountsForSave("acc-fail")).rejects.toThrow("rds down");
    // 缓存未被污染成"空账号"：仍是空（未成功回源），而非静默的成功空
    expect(store.listAccountsForUser("acc-fail")).toEqual([]);
  });

  it("内存已有账号：直接返回，不再触发 strict 回源", async () => {
    await store.replaceAccountsForUser("acc-mem", [{ accountId: 9 }]);
    fetchAccountRecordsByOwnerStrict.mockClear();
    const list = await store.prepareAccountsForSave("acc-mem");
    expect(fetchAccountRecordsByOwnerStrict).not.toHaveBeenCalled();
    expect(list.map(a => a.accountId)).toEqual([9]);
  });
});

describe("core/db/store listAccountsForUser 读路径无写 (P0-3)", () => {
  beforeEach(() => {
    saveAccountRecordsForOwner.mockClear();
    patchPlayerAccountRecord.mockReset();
  });

  it("缓存被 patch 成旧 multiply 后，读规范化只改内存、不写 RDS", async () => {
    await store.replaceAccountsForUser("p0-3-user", [
      { accountId: 1, provider: "Polymarket", multiply: 1, playerName: "pm" },
    ]);
    // 模拟余额刷新等写回未规范化的 account_data（读路径曾因此 fire-and-forget save）
    replaceAccountRecordsForOwner.mockImplementationOnce((_uid, _records, options) => options.replaceWith({
      existing: [{ accountId: 1, provider: "Polymarket", multiply: 1, playerName: "pm" }], players: [],
    }));
    await store.updateAccountForUser("p0-3-user", 1, { balance: 10, multiply: 7 });
    saveAccountRecordsForOwner.mockClear();

    const list = store.listAccountsForUser("p0-3-user");
    expect(list).toHaveLength(1);
    expect(Number(list[0].multiply)).toBe(1);
    expect(saveAccountRecordsForOwner).not.toHaveBeenCalled();
  });

  it("显式 replaceAccountsForUser 仍会落库", async () => {
    saveAccountRecordsForOwner.mockClear();
    await store.replaceAccountsForUser("p0-3-write", [
      { accountId: 2, provider: "OB", playerName: "ob1" },
    ]);
    expect(saveAccountRecordsForOwner).toHaveBeenCalledTimes(1);
    expect(saveAccountRecordsForOwner.mock.calls[0][0]).toBe("p0-3-write");
  });
});

describe("core/db/store loadAccountsForUserStrict (P0-4 D3)", () => {
  beforeEach(() => {
    fetchAccountRecordsByOwnerStrict.mockReset();
  });

  it("读成功：写入缓存并返回", async () => {
    fetchAccountRecordsByOwnerStrict.mockResolvedValueOnce([
      { accountId: 3, provider: "PredictFun" },
    ]);
    const list = await store.loadAccountsForUserStrict("pf-ok");
    expect(list.map(a => a.accountId)).toEqual([3]);
    expect(store.listAccountsForUser("pf-ok").map(a => a.accountId)).toEqual([3]);
  });

  it("读失败：抛错且不把缓存写成空列表", async () => {
    await store.replaceAccountsForUser("pf-keep", [
      { accountId: 5, provider: "PredictFun", playerName: "x" },
    ]);
    fetchAccountRecordsByOwnerStrict.mockRejectedValueOnce(new Error("rds down"));
    await expect(store.loadAccountsForUserStrict("pf-keep")).rejects.toThrow("rds down");
    expect(store.listAccountsForUser("pf-keep").map(a => a.accountId)).toEqual([5]);
  });
});
