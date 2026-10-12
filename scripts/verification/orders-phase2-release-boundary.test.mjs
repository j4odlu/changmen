// [changmen 扩展] 全文保护执行源、恢复规则与运维接线；不运行任何运维命令。
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { verifyPhase2Module, read, moduleTokens } from './orders-phase2-release-boundary.mjs';
import { verifyOrdersCompatHelper } from './orders-consumer-boundary.mjs';
const scope=JSON.parse(read('scripts/verification/orders-phase2-release-scope.json'));
describe('independent orders phase2 complete-module boundaries',()=>{
  for(const file of scope.existingRuntime) {
    it(`${file}: only exact compatibility wiring differs`,()=>expect(verifyPhase2Module(file).passed).toBe(true));
    it(`${file}: extra executable statements are rejected`,()=>expect(()=>verifyPhase2Module(file,`${read(file)}\nvoid unexpectedTradingCommand();\n`)).toThrow());
  }
  const store='server/db/rds/orderModes/gtc/pm_gtc_store.js';
  it.each([
    ['execution source','UPDATE pm_gtc_executions SET record','UPDATE orders SET execution_record'],
    ['revision gate','if (old.revision !== revision)','if (false)'],
    ['original recovery limit','LIMIT 500','LIMIT 501'],
    ['financial qualification','financial.pmShares > 0','financial.pmShares >= 0'],
    ['source lock','FOR UPDATE','FOR SHARE'],
  ])('rejects changes to %s',(_,from,to)=>{
    expect(read(store)).toContain(from);expect(()=>verifyPhase2Module(store,read(store).replace(from,to))).toThrow();
  });
  for(const file of scope.existingRuntime.filter(file=>file.includes('/scripts/ops/')&&read(file).includes('prepareOrdersExecutionCompatibility'))) {
    it(`${file}: schema validation cannot move after queries`,()=>{
      const source=read(file);const guard=source.match(/if \(process\.env\.ORDERS_EXECUTION_COMPAT === "1"\) await prepareOrdersExecutionCompatibility\((?:pool|c)\);/)[0];
      expect(()=>verifyPhase2Module(file,source.replace(guard,'')+'\n'+guard)).toThrow('before queries');
    });
  }
  it('helper content cannot be replaced by a permissive variant',()=>expect(()=>verifyOrdersCompatHelper(file=>read(file).replace('AND NOT pending.financial_ready','AND true'))).toThrow());
  it('literal payload whitespace remains significant',()=>expect(moduleTokens('post("a b");')).not.toEqual(moduleTokens('post("a  b");')));
});
