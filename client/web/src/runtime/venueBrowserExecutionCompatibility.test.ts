import { expect, it } from "vitest";
it("packages/venue-adapter/contract/index.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/contract/index"), import("@changmen/client-core/contract")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/shared/platforms.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/shared/platforms"), import("@changmen/client-core/shared/platforms")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/shared/webBridge.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/shared/webBridge"), import("@changmen/venue-browser/shared/webBridge")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/shared/webBridgeTypes.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/shared/webBridgeTypes"), import("@changmen/venue-browser/shared/webBridgeTypes")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});

it("client/packages/venue-browser/adapter/shared/changmenAuthToken.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/shared/changmenAuthToken"), import("@changmen/venue-browser/shared/changmenAuthToken")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("client/packages/venue-browser/adapter/shared/changmenWsBase.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/shared/changmenWsBase"), import("@changmen/venue-browser/shared/changmenWsBase")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("client/packages/venue-browser/adapter/shared/venueWsStatus.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/shared/venueWsStatus"), import("@changmen/venue-browser/shared/venueWsStatus")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
