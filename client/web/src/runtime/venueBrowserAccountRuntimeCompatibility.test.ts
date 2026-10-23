import { expect, it } from "vitest";
it("keeps old and canonical entries on unified after retiring legacy selection", async () => {
 const old = await import("@changmen/venue-browser/adapter/polymarket/wallet/pmWalletPrepSdk");
 const canonical = await import("@changmen/venue-browser/polymarket/wallet/pmWalletPrepSdk");
 try {
  old.setPmWalletPrepSdkForTests("legacy");
  expect(canonical.resolvePmWalletPrepSdk()).toBe("unified");
  canonical.setPmWalletPrepSdkForTests("unified");
  expect(old.resolvePmWalletPrepSdk()).toBe("unified");
 } finally {
  canonical.setPmWalletPrepSdkForTests(null);
 }
});
it("shares price preferences, notifications and unsubscribe across both entries", async () => {
 const old = await import("@changmen/venue-browser/adapter/polymarket/pmArbPriceBufferMode");
 const canonical = await import("@changmen/venue-browser/polymarket/quotes/pmArbPriceBufferMode");
 const previous = canonical.getPmArbPriceBufferPrefs();
 canonical.resetPmArbPriceBufferPrefsForTests();
 const modes: boolean[] = [];
 let policies = 0;
 const stopMode = old.onPmTickBufferModeChange(enabled => modes.push(enabled));
 const stopPolicy = canonical.onPmPricePolicyChange(() => { policies++; });
 try {
  canonical.setPmArbPriceBufferPrefs({ enabled: true, mode: "tick", multiplier: 1.02 });
  expect(old.getPmArbPriceBufferPrefs()).toEqual({ enabled: true, mode: "tick", multiplier: 1.02 });
  expect(modes).toEqual([true]);
  expect(policies).toBe(1);
  old.setPmArbPriceBufferPrefs({ enabled: true, mode: "tick", multiplier: 1.02 });
  expect(policies).toBe(1);
  stopMode(); stopPolicy();
  old.resetPmArbPriceBufferPrefsForTests();
  expect(canonical.getPmArbPriceBufferPrefs()).toEqual({ enabled: false, multiplier: 1.01 });
  expect(modes).toEqual([true]);
  expect(policies).toBe(1);
 } finally {
  stopMode(); stopPolicy();
  canonical.setPmArbPriceBufferPrefs(previous);
 }
});
it("packages/venue-adapter/polymarket/wallet/balance.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/wallet/balance"), import("@changmen/venue-browser/polymarket/wallet/balance")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/wallet/pmWalletPrepSdk.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/wallet/pmWalletPrepSdk"), import("@changmen/venue-browser/polymarket/wallet/pmWalletPrepSdk")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/wallet/walletPrepUnified.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/wallet/walletPrepUnified"), import("@changmen/venue-browser/polymarket/wallet/walletPrepUnified")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/wallet/relayer.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/wallet/relayer"), import("@changmen/venue-browser/polymarket/wallet/relayer")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/transport/pmAutoTransport.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/transport/pmAutoTransport"), import("@changmen/venue-browser/polymarket/transport/pmAutoTransport")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/transport/pmOfficialReachability.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/transport/pmOfficialReachability"), import("@changmen/venue-browser/polymarket/transport/pmOfficialReachability")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/quotes/pmArbPriceBufferMode.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/pmArbPriceBufferMode"), import("@changmen/venue-browser/polymarket/quotes/pmArbPriceBufferMode")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/markets/pmSportPrewarm.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/markets/pmSportPrewarm"), import("@changmen/venue-browser/polymarket/markets/pmSportPrewarm")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
