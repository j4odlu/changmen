import fs from "node:fs";
import { expect, test } from "vitest";
import { PM_SDK_RETIREMENT as record, restorePmSdkRetirementSource, verifyPmSdkRetirement, historicalRetiredPmSdkTarget } from "./pm-sdk-retirement.mjs";
const read = file => fs.readFileSync(file, "utf8");

test("the reviewed SDK retirement preserves the complete previous source and lock view", () => {
  expect(verifyPmSdkRetirement(read)).toEqual({ files: record.files.length, assets: 2 });
  for (const row of record.files.filter(row => row.afterSha !== null)) {
    const source = read(row.file);
    expect(restorePmSdkRetirementSource(row.file, source, read)).toBe(row.before);
    const mutation = source + "\nvoid unreviewedChange();\n";
    expect(restorePmSdkRetirementSource(row.file, mutation, read)).toBe(mutation);
    expect(() => verifyPmSdkRetirement(file => file === row.file ? mutation : read(file))).toThrow();
  }
});

test("captured wallet and HMAC fixtures cannot change behind the historical source view", () => {
  for (const asset of record.assets) {
    const altered = file => read(file) + (file === asset.file ? "\n" : "");
    expect(() => verifyPmSdkRetirement(altered)).toThrow("captured SDK fixture changed");
    const row = record.files.find(row => row.afterSha !== null);
    expect(() => restorePmSdkRetirementSource(row.file, read(row.file), altered)).toThrow();
  }
});

test("both legacy SDKs are absent from the installed tree and all lock dependency declarations", () => {
  const lock = JSON.parse(read("package-lock.json"));
  for (const name of ["@polymarket/builder-relayer-client", "@polymarket/builder-signing-sdk"]) {
    expect(fs.existsSync(`node_modules/${name}`)).toBe(false);
    for (const [file, pkg] of Object.entries(lock.packages)) {
      expect(file.endsWith(`node_modules/${name}`)).toBe(false);
      for (const group of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"])
        expect(pkg[group]?.[name], `${file}: ${group}`).toBeUndefined();
    }
  }
});

test("unreviewed lock changes cannot restore the previous lock", () => {
  const source = read("package-lock.json") + "\n";
  expect(restorePmSdkRetirementSource("package-lock.json", source, read)).toBe(source);
  expect(() => verifyPmSdkRetirement(file => file === "package-lock.json" ? source : read(file))).toThrow();
});

test("only a captured historical import can reference an uninstalled SDK", () => {
  expect(historicalRetiredPmSdkTarget("packages/venue-adapter/polymarket/wallet/depositWallet.ts", "@polymarket/builder-signing-sdk"))
    .toBe("retired:@polymarket/builder-signing-sdk@0.0.8");
  expect(() => historicalRetiredPmSdkTarget("unreviewed.ts", "@polymarket/builder-signing-sdk")).toThrow("unrecorded retired SDK edge");
  expect(historicalRetiredPmSdkTarget("unreviewed.ts", "viem")).toBeUndefined();
});
