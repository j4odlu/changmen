import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";
import { PM_WALLET_ADDRESS_OPTIMIZATION as record, restorePmWalletAddressOptimizationSource, verifyPmWalletAddressOptimization } from "./pm-wallet-address-optimization.mjs";
const read = file => fs.readFileSync(file, "utf8");
test("the native ESM wallet implementation is certified without changing an existing inventory", () => {
  expect(verifyPmWalletAddressOptimization(read)).toEqual({ files: 6, assets: 1 });
});
for (const row of record.files) {
  test(`${row.file}: only the complete reviewed optimization restores its original historical source`, () => {
    const source = read(row.file);
    expect(row.before).toBe(execFileSync("git", ["show", `${record.baseline}:${row.file}`], { encoding: "utf8" }).replaceAll("\r\n", "\n"));
    expect(restorePmWalletAddressOptimizationSource(row.file, source, read)).toBe(row.before);
    expect(restorePmWalletAddressOptimizationSource(row.file, source.replace(/\r?\n/g, "\r\n"), read)).toBe(row.before);
    const mutation = source + "\nvoid unreviewedChange();\n";
    expect(restorePmWalletAddressOptimizationSource(row.file, mutation, read)).toBe(mutation);
    expect(restorePmWalletAddressOptimizationSource("unrelated.ts", source, read)).toBe(source);
  });
}
test("changes to the wallet formula or RPC decision cannot hide behind the historical source view", () => {
  for (const [from, to] of [["0x6100523d8160233d3973n", "0x6100523d8160233d3974n"],
    ["code !== undefined && code !== \"0x\"", "false"], ["const beacon = await factoryBeacon(client)", "const beacon = zeroAddress"]]) {
    const mutation = file => file === record.assets[0].file ? read(file).replace(from, to) : read(file);
    expect(mutation(record.assets[0].file)).not.toBe(read(record.assets[0].file));
    expect(() => verifyPmWalletAddressOptimization(mutation)).toThrow("wallet derivation implementation changed");
    expect(() => restorePmWalletAddressOptimizationSource(record.files[0].file, read(record.files[0].file), mutation))
      .toThrow("wallet derivation implementation changed");
  }
});
