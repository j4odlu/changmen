import { afterEach, expect, test, vi } from "vitest";
import { derivePolymarketDepositWalletAddress } from "@changmen/venue-browser/polymarket/wallet/depositWallet";
import { resolvePolygonRpcUrls } from "@changmen/venue-browser/polymarket/wallet/polygonRpc";

import fixtures from "./depositWalletAddress.fixtures.json";

const beaconAddress = "3333333333333333333333333333333333333333";
const states = ["zero", "beacon-new", "beacon-uups", "beacon-zero-byte", "beacon-null-code", "empty", "short", "trailing-address"] as const;
type State = typeof states[number] | "network-error" | "rpc-error" | "code-error" | "revert" | "fallback";
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

async function run(privateKey: string, state: State) {
  vi.useFakeTimers();
  const trace: unknown[] = [];
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    trace.push({ url: new URL(String(_url)).href, method: request.method, params: request.params });
    if (state === "fallback" && new URL(String(_url)).href === new URL(resolvePolygonRpcUrls()[0]!).href)
      throw new TypeError("offline first RPC unavailable");
    if (state === "network-error") throw new TypeError("offline RPC unavailable");
    if (state === "rpc-error" || state === "code-error" && request.method === "eth_getCode")
      return Response.json({ jsonrpc: "2.0", id: request.id, error: { code: -32603, message: "offline upstream failure" } });
    if (request.method === "eth_call" && state === "revert")
      return Response.json({ jsonrpc: "2.0", id: request.id, error: { code: 3, message: "execution reverted", data: "0x" } });
    const beacon = state === "zero" || state === "fallback" ? "0".repeat(40) : beaconAddress;
    const callResult = state === "empty" ? "0x" : state === "short" ? "0x12"
      : state === "trailing-address" ? `0x${"f".repeat(64)}${beacon}` : `0x${beacon.padStart(64, "0")}`;
    const code = state === "beacon-uups" ? "0x6000" : state === "beacon-zero-byte" ? "0x0"
      : state === "beacon-null-code" ? null : "0x";
    return Response.json({ jsonrpc: "2.0", id: request.id, result: request.method === "eth_call" ? callResult : code });
  });
  try {
    const operation = derivePolymarketDepositWalletAddress({ privateKey });
    const pending = operation.then(address => ({ address }), error => ({ error: { name: error.name, message: error.message } }));
    await vi.runAllTimersAsync();
    return { ...await pending, trace };
  }
  finally { fetch.mockRestore(); vi.useRealTimers(); }
}

test.each([1, 2, 3, 7, 42, 255, 65535, 123456789].flatMap(key => states.map(state => ({ key, state }))))(
  "$key/$state: viem retains the official SDK address and ordered RPC effects", async ({ key, state }) => {
    const privateKey = `0x${BigInt(key).toString(16).padStart(64, "0")}`;
    const after = await run(privateKey, state);
    expect(after).toMatchObject({ address: fixtures.cases.find(row => row.key === key && row.state === state)!.address });
    expect(after).toHaveProperty("address");
    expect(after.trace[0]).toMatchObject({ method: "eth_call", params: [{
      to: "0x00000000000Fb5C9ADea0298D729A0CB3823Cc07", data: "0x49493a4d",
    }, "latest"] });
    expect(after.trace).toHaveLength(["zero", "empty", "short"].includes(state) ? 1 : 2);
  },
);

test.each(["network-error", "rpc-error", "code-error", "revert"] as const)("%s cannot silently choose another wallet", async state => {
  const privateKey = `0x${"2".repeat(64)}`;
  const after = await run(privateKey, state);
  expect(after).toHaveProperty("error");
  expect(after).not.toHaveProperty("address");
});

test("an unavailable preferred RPC retains the same fallback order and wallet", async () => {
  const privateKey = `0x${"2".padStart(64, "0")}`;
  const after = await run(privateKey, "fallback");
  expect(after).toMatchObject({ address: fixtures.cases.find(row => row.key === 2 && row.state === "zero")!.address });
  expect(after).toHaveProperty("address");
  expect(new Set(after.trace.map(row => (row as { url: string }).url)).size).toBeGreaterThan(1);
});

test.each(["", "not-a-key", `0x${"0".repeat(64)}`, `0x${"f".repeat(64)}`, "0X" + "2".repeat(64)])(
  "invalid private key %s fails before any RPC", async privateKey => {
    const after = await run(privateKey, "zero");
    expect(after).toHaveProperty("error");
    expect(after.trace).toEqual([]);
  },
);
