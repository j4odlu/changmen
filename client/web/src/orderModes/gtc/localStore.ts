/** [changmen 扩展] GTC 执行由客户端 IndexedDB 原子持久化；同源多标签页共用防重记录。 */
import type { GtcExecution, GtcCommand, GtcPlan } from "@changmen/shared/pm_gtc";
import type { GtcConfirmedResult } from "@changmen/shared/pm_gtc_result";
import { applyGtcCommand, createGtcExecution } from "@changmen/shared/pm_gtc";
import { shallowReactive } from "vue";
import { confirmedGtcResult, gtcResultKey } from "./confirmedResult";
import { gtcFinancialOrder } from "./financialOrder";

const DB_NAME = "changmen_gtc_client_v1";
type Stored = { key: string; owner: string; hashKey: string; row: GtcExecution; resultKey?: string; senders?: Partial<Record<"PM" | "OTHER", string>> };
const senderId = crypto.randomUUID();
export interface PendingGtcResult { key: string; owner: string; result: GtcConfirmedResult; at: number; failures: number }
export const localGtcChanges = shallowReactive({ revision: 0 });
const key = (owner: string, id: string) => JSON.stringify([owner, id]);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function changed() {
  localGtcChanges.revision++;
  if (typeof BroadcastChannel !== "undefined") {
    try {
      const channel = new BroadcastChannel(DB_NAME);
      channel.postMessage("changed"); channel.close();
    }
    catch { /* 通知不可用不改变已提交的执行许可；各页面仍定期读取本地数据库。 */ }
  }
}
export function listenLocalGtcChanges(): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  try {
    const receiver = new BroadcastChannel(DB_NAME);
    receiver.onmessage = () => { localGtcChanges.revision++; };
    return () => receiver.close();
  }
  catch { return () => {}; }
}
async function open(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") throw new Error("GTC 需要可用的客户端持久化，尚未发送订单");
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      const records = db.createObjectStore("records", { keyPath: "key" });
      records.createIndex("owner", "owner"); records.createIndex("hash", "hashKey", { unique: true });
      db.createObjectStore("results", { keyPath: "key" }).createIndex("owner", "owner");
      db.createObjectStore("meta");
    };
    request.onerror = () => reject(request.error ?? new Error("GTC 本地数据库不可用"));
    request.onblocked = () => reject(new Error("GTC 本地数据库被占用，尚未发送订单"));
    request.onsuccess = () => resolve(request.result);
  });
}
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}
function complete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new Error("GTC 本地事务未提交"));
    tx.onerror = () => reject(tx.error ?? new Error("GTC 本地写入失败"));
  });
}
function stored(owner: string, row: GtcExecution, resultKey?: string): Stored {
  return { key: key(owner, row.id), owner, hashKey: JSON.stringify([owner, row.plan.playerId, row.plan.orderHash.toLowerCase()]), row: clone(row), resultKey };
}
async function transaction<T>(stores: string[], mode: IDBTransactionMode, run: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const db = await open();
  const tx = db.transaction(stores, mode); const done = complete(tx);
  void done.catch(() => {});
  try { const value = await run(tx); await done; return value; }
  catch (error) { try { tx.abort(); } catch {} await done.catch(() => {}); throw error; }
  finally { db.close(); }
}
export async function createLocalGtc(owner: string, id: string, maker: string, plan: GtcPlan): Promise<GtcExecution> {
  const row = await transaction(["records"], "readwrite", async (tx) => {
    const store = tx.objectStore("records"); const old = await request(store.get(key(owner, id))) as Stored | undefined;
    if (old) {
      if (old.row.maker !== maker || JSON.stringify(old.row.plan) !== JSON.stringify(plan)) throw new Error("GTC 执行身份冲突");
      return old.row;
    }
    const hashKey = JSON.stringify([owner, plan.playerId, plan.orderHash.toLowerCase()]);
    if (await request(store.index("hash").get(hashKey))) throw new Error("GTC 原签单已有执行记录，禁止重复发送");
    const created = createGtcExecution(id, owner, `137:polymarket-collateral:${maker}`, maker, clone(plan), Date.now());
    await request(store.add(stored(owner, created))); return created;
  });
  changed(); return clone(row);
}
export async function listLocalGtc(owner: string): Promise<GtcExecution[]> {
  return transaction(["records"], "readonly", async tx => (await request(tx.objectStore("records").index("owner").getAll(owner)) as Stored[]).map(record => record.row));
}
export async function mutateLocalGtc(owner: string, id: string, revision: number, command: GtcCommand): Promise<GtcExecution> {
  const row = await transaction(["records", "results"], "readwrite", async tx => {
    const store = tx.objectStore("records"); const old = await request(store.get(key(owner, id))) as Stored | undefined;
    if (!old) throw new Error("GTC 本地执行记录不存在，禁止重发");
    if (old.row.revision !== revision) throw new Error("GTC 本地执行已更新，请重新读取；禁止重放发送许可");
    if (command.kind === "not_sent" && (command.leg === "PM" ? old.row.pmAuthorized : old.row.other.state !== "not_attempted")
      && old.senders?.[command.leg] !== senderId)
      throw new Error("当前页面没有该腿发送许可，不能改写其它页面的发送结果");
    const senders = { ...old.senders };
    if (command.kind === "authorize_pm") senders.PM = senderId;
    if (command.kind === "authorize_other") senders.OTHER = senderId;
    const next = applyGtcCommand(clone(old.row), clone(command), Date.now());
    const financial = gtcFinancialOrder(next);
    if (financial) next.financialOrder = financial; else delete next.financialOrder;
    const result = confirmedGtcResult(next); const fingerprint = result ? gtcResultKey(result) : old.resultKey;
    if (result && fingerprint !== old.resultKey)
      await request(tx.objectStore("results").put({ key: old.key, owner, result, at: 0, failures: 0 } satisfies PendingGtcResult));
    await request(store.put({ ...stored(owner, next, fingerprint), senders })); return next;
  });
  changed(); return clone(row);
}
export async function importLocalGtc(owner: string, rows: GtcExecution[]): Promise<void> {
  await transaction(["records", "results"], "readwrite", async tx => {
    const store = tx.objectStore("records");
    for (const row of rows) {
      if (row.owner !== owner || !row.plan?.orderHash) throw new Error("GTC 历史执行归属或原单身份无效");
      const result = confirmedGtcResult(row);
      const value = stored(owner, row, result ? gtcResultKey(result) : undefined);
      if (!await request(store.get(value.key)) && !await request(store.index("hash").get(value.hashKey))) {
        await request(store.put(value));
        if (result) await request(tx.objectStore("results").put({ key: value.key, owner, result, at: 0, failures: 0 } satisfies PendingGtcResult));
      }
    }
  }); changed();
}
export async function localGtcMigrationDone(owner: string): Promise<boolean> {
  return transaction(["meta"], "readonly", async tx => Boolean(await request(tx.objectStore("meta").get(`full-history:${owner}`))));
}
export async function finishLocalGtcMigration(owner: string): Promise<void> {
  await transaction(["meta"], "readwrite", async tx => { await request(tx.objectStore("meta").put(true, `full-history:${owner}`)); });
}
export async function pendingGtcResults(owner: string): Promise<PendingGtcResult[]> {
  return transaction(["results"], "readonly", async tx => await request(tx.objectStore("results").index("owner").getAll(owner)) as PendingGtcResult[]);
}
export async function finishGtcResult(entry: PendingGtcResult, failure = false): Promise<void> {
  await transaction(["results"], "readwrite", async tx => {
    const store = tx.objectStore("results"); const current = await request(store.get(entry.key)) as PendingGtcResult | undefined;
    if (!current || current.result.revision !== entry.result.revision) return;
    if (!failure) await request(store.delete(entry.key));
    else await request(store.put({ ...current, failures: current.failures + 1, at: Date.now() + Math.min(60000, 5000 * 2 ** Math.min(current.failures, 4)) }));
  });
}
