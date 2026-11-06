// Explicit offline final-payout coverage. Fill/cancel confirmation is a separate concern.
export const settlementTests = {
  rulesAndPersistence: [
    "packages/shared/pm_settlement.test.mjs",
    "packages/shared/currency.test.ts",
    "server/backend/core/integrations/polymarket/settlement.test.mjs",
    "server/backend/core/integrations/polymarket/settlement_equal_split.test.mjs",
    "server/backend/core/account/order/save_pm_settlement.test.js",
    "server/backend/core/account/order/save_pm_equal_split.test.js",
    "server/backend/core/account/order/polymarket_order_settlement.test.js",
    "server/backend/core/account/order/position_events.test.mjs",
    "server/backend/core/account/order/profit_cny.test.mjs",
    "server/backend/core/account/order/prediction_profit.test.mjs",
    "server/backend/core/account/order/save_pf.test.js",
    "rds/rds/orderModes/gtc/pm_gtc_ledger.test.mjs",
    "rds/rds/orderModes/gtc/pm_gtc_financial.test.mjs",
    "server/backend/core/integrations/predictfun/pf_settle.test.js",
    "server/backend/core/integrations/predictfun/pf_exec_settle.test.js",
    "server/backend/core/integrations/predictfun/pf_lifecycle.test.js",
    "server/backend/core/integrations/predictfun/pf_fee.test.js",
    "server/backend/core/integrations/predictfun/pf_fill.test.js",
    "server/backend/core/integrations/predictfun/pf_orders.test.js",
    "server/backend/core/integrations/predictfun/pf_user_dto.test.js",
    "server/backend/core/integrations/predictfun/pf_ledger.test.js",
  ],
  browserAndDisplay: [
    ...["equalSplit", "finalPayoutRecheck", "storedSettlement", "storedMarketRefresh", "settlementSources",
      "pmFee", "pmLogicalPosition", "pmOrderSync", "pmOrderPrice", "orderSyncUpdate", "orderSyncUpdateBoundary", "orderMarketReader", "orderFieldContract", "orderTradeProcessing", "orderTradeMapping"].map(name =>
      `client/packages/venue-browser/adapter/polymarket/tests/orders/${name}.test.ts`),
    ...["pmOrderDisplay", "pfOrderDisplay", "pfOrderCycle", "moneyRisk.pendingPm"].map(name =>
      `client/web/src/shared/${name}.test.ts`),
    "client/web/src/orderModes/gtc/financialOrder.test.ts",
    "client/web/src/orderModes/gtc/sellFinancials.test.ts",
    "client/web/src/components/order/orderListPredictionPresentation.test.ts",
    "client/web/src/components/order/OrderList.profitLine.test.ts",
  ],
};
