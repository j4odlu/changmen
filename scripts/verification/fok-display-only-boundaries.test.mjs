// [changmen 扩展] 对真实已发布 DisplayOnly 保护做负向变异；不模拟放宽后的业务源码。
import fs from 'node:fs';
import { describe,it,expect } from 'vitest';
import { gitSource,verifyProtectedSource } from './fok-exact-boundaries.mjs';
import { checkOrdinaryOrderList } from './fok-order-list-boundary.mjs';
import { verifyActualPublicModule,publicFiles } from './public-release-boundaries.mjs';
const read=file=>fs.readFileSync(file,'utf8').replaceAll('\r\n','\n');
const bases=['219535c8','75b1efac66625e5f2bc9884a965b244bfaf337ed'];
describe('exact deployed DisplayOnly guards and original financial consumers',()=>{
  for(const base of bases) {
    const link='client/web/src/shared/orderLink.ts';
    const verify=(source)=>verifyProtectedSource(link,source,gitSource(base,link));
    it(`${base}: rebind guard preserves complete original module`,()=>expect(()=>verify(read(link))).not.toThrow());
    for(const [name,before,after] of [
      ['deleted guard','  if (row.DisplayOnly)\n    return false;\n',''],
      ['allow display rebind','if (row.DisplayOnly)\n    return false;','if (row.DisplayOnly)\n    return true;'],
      ['widen identity guard','if (row.DisplayOnly)','if (row.DisplayOnly || row.Type === "RAY")'],
      ['extra business command','return false;','return false; void unexpectedBet();'],
    ]) it(`${base}: rejects ${name}`,()=>{expect(read(link)).toContain(before);expect(()=>verify(read(link).replace(before,after))).toThrow();});
    const list='client/web/src/components/order/OrderList.vue';
    for(const [name,before,after] of [
      ['sell click bypass','async function onPmSell(row: OrderRow) {\n  if (row.DisplayOnly)\n    return;','async function onPmSell(row: OrderRow) {'],
      ['wrong null financial qualification','row.DisplayOnly && row.BetMoney == null','row.DisplayOnly && row.BetMoney === 0'],
      ['changed amount fallback','toFixed(pmOrderStakeDisplayCny(block.row), 0)','toFixed(pmOrderStakeDisplayCny(block.row), 2)'],
      ['optional details writable','!allowPmSell && !allowPfSell','false'],
    ]) it(`${base}: rejects ${name}`,()=>{expect(read(list)).toContain(before);expect(()=>checkOrdinaryOrderList(read(list).replace(before,after),gitSource(base,list))).toThrow();});
    const sell='client/web/src/stores/account/pmManualSell.ts';
    for(const [name,before,after] of [
      ['unowned GTC dispatch','if (buyRow.PmGtcExecutionId)','if (true)'],
      ['changed GTC payload','pmGtcExecutionId: buyRow.PmGtcExecutionId','pmGtcExecutionId: "other"'],
      ['changed original persist input','await persist();','await saveOrders(account, []);'],
      ['session check removed','if (!current()) return false;','if (false) return false;'],
    ]) it(`${base}: rejects ${name}`,()=>{expect(read(sell)).toContain(before);expect(()=>verifyProtectedSource(sell,read(sell).replace(before,after),gitSource(base,sell))).toThrow();});
  }
  for(const file of publicFiles) it(`${file}: unexpected new API is rejected`,()=>expect(()=>verifyActualPublicModule(file,read(file)+'\nexport function unexpectedAction(){}',read(file))).toThrow());
});
