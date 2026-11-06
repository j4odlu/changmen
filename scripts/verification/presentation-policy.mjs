// Planning/sealing also runs before npm install: keep this registry dependency-free.
export const presentationComponents = ["OrderProfitLine", "OrderQuoteLine", "OrderMarketDetails", "OrderStatusBadge", "OrderTag", "OrderLiveQuoteLine"]
  .map(name => `client/web/src/components/order/presentation/${name}.vue`);
const directTests = ["client/web/src/components/order/presentation/OrderProfitLine.test.ts",
  "client/web/src/components/order/presentation/OrderPresentation.test.ts"];
export const presentationTests = [...directTests,
  "client/web/src/components/order/OrderList.pendingPm.test.ts",
  "client/web/src/components/order/OrderList.makeupOddsBand.test.ts",
  "client/web/src/components/order/OrderList.profitLine.test.ts",
  "client/web/src/components/order/OrderList.structure.test.ts",
  "client/web/src/components/order/OrderList.runtime.test.ts"];
const eligible = new Set([...presentationComponents, ...directTests]);
export const isPresentationOnly = paths => paths.length > 0 && paths.every(file => eligible.has(file));
