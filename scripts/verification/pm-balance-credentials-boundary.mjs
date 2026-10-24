// [changmen 扩展] bda8e916 已撤销；此兼容入口保留后续 SDK、订单哈希、价格展示及独立余额修复的历史校验接线。
import fs from "node:fs";
import { pmCredentialSdkFiles, restorePmCredentialSdkSource, verifyPmCredentialSdkSources } from "./pm-credential-sdk-boundary.mjs";
import { pmOrderHashContractFiles, restorePmOrderHashContractSource, verifyPmOrderHashContractSources } from "./pm-order-hash-contract-boundary.mjs";
import { PM_OFFICIAL_ORDER_PRICE, restorePmOfficialOrderPriceSource, verifyPmOfficialOrderPriceSources } from "./pm-official-order-price.mjs";
import { PM_DELAYED_BALANCE_REFRESH, restorePmDelayedBalanceRefreshSource, verifyPmDelayedBalanceRefreshSource } from "./pm-delayed-balance-refresh.mjs";
import { PM_ACCOUNT_CONNECTION, restorePmAccountConnectionSource, verifyPmAccountConnectionSources } from "./pm-account-connection.mjs";

export const pmBalanceCredentialFiles = new Set([
  ...PM_ACCOUNT_CONNECTION.files.map(row => row.file),
  PM_DELAYED_BALANCE_REFRESH.file,
  ...pmCredentialSdkFiles,
  ...pmOrderHashContractFiles,
  ...PM_OFFICIAL_ORDER_PRICE.files.map(row => row.file),
]);

export function restorePmBalanceCredentialsSource(file, source) {
  source = restorePmAccountConnectionSource(file, source);
  source = restorePmDelayedBalanceRefreshSource(file, source);
  return restorePmCredentialSdkSource(file, restorePmOrderHashContractSource(file,
    restorePmOfficialOrderPriceSource(file, source)));
}

export function verifyPmBalanceCredentialsSources(read = file => fs.readFileSync(new URL("../../" + file, import.meta.url), "utf8")) {
  verifyPmAccountConnectionSources(read);
  const connectionRead = read;
  read = file => restorePmAccountConnectionSource(file, connectionRead(file));
  verifyPmDelayedBalanceRefreshSource(read);
  const delayedRead = read;
  read = file => restorePmDelayedBalanceRefreshSource(file, delayedRead(file));
  verifyPmOfficialOrderPriceSources(read);
  const officialRead = read;
  read = file => restorePmOfficialOrderPriceSource(file, officialRead(file));
  verifyPmOrderHashContractSources(read);
  const hashRead = read;
  return verifyPmCredentialSdkSources(file => restorePmOrderHashContractSource(file, hashRead(file)));
}
