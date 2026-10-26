/** [changmen 扩展] 仅供测试模拟发布前的旧客户端写入，运行时代码不得导入。 */
import type { GtcExecution, GtcPlan } from "@changmen/shared/pm_gtc";
import { createGtcExecution } from "@changmen/shared/pm_gtc";
import { changed, clone, key, request, transaction } from "@/orderModes/gtc/storage";
function stored(owner: string, row: GtcExecution) {
  return { key: key(owner, row.id), owner, hashKey: JSON.stringify([owner, row.plan.playerId, row.plan.orderHash.toLowerCase()]), row: clone(row) };
}
type Stored = ReturnType<typeof stored>;
export async function createLegacyGtc(owner: string, id: string, maker: string, plan: GtcPlan): Promise<GtcExecution> {
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
