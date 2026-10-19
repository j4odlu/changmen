import { expect, it } from "vitest";
it("client/packages/venue-browser/adapter/polymarket/realtime/ws.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("../../realtime/ws"), import("@changmen/venue-browser/polymarket/ws")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("client/packages/venue-browser/adapter/polymarket/realtime/sportMarketWs.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("../../realtime/sportMarketWs"), import("@changmen/venue-browser/polymarket/sportMarketWs")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("client/packages/venue-browser/adapter/polymarket/realtime/wsConfig.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("../../realtime/wsConfig"), import("@changmen/venue-browser/polymarket/wsConfig")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("client/packages/venue-browser/adapter/polymarket/realtime/sportWsConfig.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("../../realtime/sportWsConfig"), import("@changmen/venue-browser/polymarket/sportWsConfig")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("client/packages/venue-browser/adapter/polymarket/realtime/pmWsSourceMode.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("../../realtime/pmWsSourceMode"), import("@changmen/venue-browser/polymarket/pmWsSourceMode")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("client/packages/venue-browser/adapter/polymarket/realtime/pmMarketWsMode.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("../../realtime/pmMarketWsMode"), import("@changmen/venue-browser/polymarket/pmMarketWsMode")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("client/packages/venue-browser/adapter/polymarket/realtime/pmUserWsMode.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("../../realtime/pmUserWsMode"), import("@changmen/venue-browser/polymarket/pmUserWsMode")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("client/packages/venue-browser/adapter/polymarket/transport/pmRoutingPreference.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("../../transport/pmRoutingPreference"), import("@changmen/venue-browser/polymarket/pmRoutingPreference")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("client/packages/venue-browser/adapter/polymarket/transport/pmTransportMode.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("../../transport/pmTransportMode"), import("@changmen/venue-browser/polymarket/pmTransportMode")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("client/packages/venue-browser/adapter/polymarket/submission/client/pmOrderSubmitMode.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("../../submission/client/pmOrderSubmitMode"), import("@changmen/venue-browser/polymarket/pmOrderSubmitMode")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("client/packages/venue-browser/adapter/polymarket/diagnostics/pmMarketClientMetrics.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("../../diagnostics/pmMarketClientMetrics"), import("@changmen/venue-browser/polymarket/pmMarketClientMetrics")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("client/packages/venue-browser/adapter/polymarket/diagnostics/pmExecutionMetrics.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("../../diagnostics/pmExecutionMetrics"), import("@changmen/venue-browser/polymarket/pmExecutionMetrics")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("client/packages/venue-browser/adapter/polymarket/quotes/marketQuoteHub.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("../../quotes/marketQuoteHub"), import("@changmen/venue-browser/polymarket/marketQuoteHub")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("client/packages/venue-browser/adapter/polymarket/quotes/sportQuoteHub.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("../../quotes/sportQuoteHub"), import("@changmen/venue-browser/polymarket/sportQuoteHub")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("client/packages/venue-browser/adapter/polymarket/transport/api.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("../../transport/api"), import("@changmen/venue-browser/polymarket/api")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("client/packages/venue-browser/adapter/shared/changmenAuthToken.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("../../../shared/changmenAuthToken"), import("@changmen/venue-browser/shared/changmenAuthToken")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("client/packages/venue-browser/adapter/shared/changmenWsBase.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("../../../shared/changmenWsBase"), import("@changmen/venue-browser/shared/changmenWsBase")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("client/packages/venue-browser/adapter/shared/venueWsStatus.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("../../../shared/venueWsStatus"), import("@changmen/venue-browser/shared/venueWsStatus")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
