// [changmen 扩展] bda8e916 已撤销；此兼容入口仅保留后续 SDK、订单哈希及价格展示的历史校验接线。
import fs from "node:fs";
import { pmCredentialSdkFiles, restorePmCredentialSdkSource, verifyPmCredentialSdkSources } from "./pm-credential-sdk-boundary.mjs";
import { pmOrderHashContractFiles, restorePmOrderHashContractSource, verifyPmOrderHashContractSources } from "./pm-order-hash-contract-boundary.mjs";
import { PM_OFFICIAL_ORDER_PRICE, restorePmOfficialOrderPriceSource, verifyPmOfficialOrderPriceSources } from "./pm-official-order-price.mjs";

export const pmBalanceCredentialFiles = new Set([
  ...pmCredentialSdkFiles,
  ...pmOrderHashContractFiles,
  ...PM_OFFICIAL_ORDER_PRICE.files.map(row => row.file),
]);

export function restorePmBalanceCredentialsSource(file, source) {
  return restorePmCredentialSdkSource(file, restorePmOrderHashContractSource(file,
    restorePmOfficialOrderPriceSource(file, source)));
}

export function verifyPmBalanceCredentialsSources(read = file => fs.readFileSync(new URL("../../" + file, import.meta.url), "utf8")) {
  verifyPmOfficialOrderPriceSources(read);
  const officialRead = read;
  read = file => restorePmOfficialOrderPriceSource(file, officialRead(file));
  verifyPmOrderHashContractSources(read);
  const hashRead = read;
  return verifyPmCredentialSdkSources(file => restorePmOrderHashContractSource(file, hashRead(file)));
}
