// [changmen 扩展] 本候选不增加任何公开 action；实际已发布模块必须全文相等。
import assert from 'node:assert/strict';
import { moduleTokens } from './fok-exact-boundaries.mjs';
export const publicFiles = ['server/backend/core/esport-api/account_client_routes.ts','server/backend/core/esport-api/pm_pf_routes.ts','server/backend/core/account/admin_orders.js','client/web/src/shared/adminOrderDisplay.ts','client/web/src/types/extensionPrefs.ts'];
export function verifyActualPublicModule(file,current,original) {
  assert(publicFiles.includes(file),'unknown public module');
  assert.equal(typeof original,'string',`Missing captured source: ${file}`);
  assert.deepEqual(moduleTokens(current),moduleTokens(original),`${file}: entire deployed public module unchanged`);
}
