/** [changmen 扩展] GTC 本地事务及通知；沿用既有数据库和索引，不读取订单或业务字段。 */
import { shallowReactive } from "vue";
const DB_NAME = "changmen_gtc_client_v1";
export const localGtcChanges = shallowReactive({ revision: 0 });
export const key = (owner: string, id: string) => JSON.stringify([owner, id]);
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export function changed() {
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
export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}
function complete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new Error("GTC 本地事务未提交"));
    tx.onerror = () => reject(tx.error ?? new Error("GTC 本地写入失败"));
  });
}
export async function transaction<T>(stores: string[], mode: IDBTransactionMode, run: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const db = await open();
  const tx = db.transaction(stores, mode); const done = complete(tx);
  void done.catch(() => {});
  try { const value = await run(tx); await done; return value; }
  catch (error) { try { tx.abort(); } catch {} await done.catch(() => {}); throw error; }
  finally { db.close(); }
}
