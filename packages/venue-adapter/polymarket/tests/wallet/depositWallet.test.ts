import { decodeFunctionData, zeroAddress, type Hex } from "viem";
import { afterEach, describe, expect, test, vi } from "vitest";
import { POLYGON_POLYMARKET, polymarketTradeSpenders } from "@changmen/venue-browser/polymarket/wallet/contracts";
import {
  buildDepositWalletApprovalCalls,
  createPolymarketRelayClient,
  derivePolymarketDepositWalletAddress,
} from "@changmen/venue-browser/polymarket/wallet/depositWallet";
import { buildStandardApprovalTransactions } from "@changmen/venue-browser/polymarket/wallet/relayer";
import {
  POLYGON_RPC_URLS,
  resolvePolygonRpcUrls,
} from "@changmen/venue-browser/polymarket/wallet/polygonRpc";

const DEPOSIT_FACTORY = "0x00000000000fb5c9adea0298d729a0cb3823cc07";
const FACTORY_BEACON_SELECTOR = "0x49493a4d";
const FIXTURE_BEACON = "0x3333333333333333333333333333333333333333";

// [changmen 扩展] Keep the real SDK, wallet signer and fallback transport in
// these unit tests; only the external JSON-RPC boundary receives fixtures.
function mockFactoryRpc(beacon: Hex = zeroAddress, deployed = false) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    expect(resolvePolygonRpcUrls().map(value => new URL(value).href)).toContain(new URL(String(url)).href);
    const request = JSON.parse(String(init?.body)) as {
      id: number;
      method: string;
      params: Array<string | { to: string; data: string }>;
    };
    if (request.method === "eth_call") {
      const call = request.params[0] as { to: string; data: string };
      expect(call.to.toLowerCase()).toBe(DEPOSIT_FACTORY);
      expect(call.data).toBe(FACTORY_BEACON_SELECTOR);
      return Response.json({ jsonrpc: "2.0", id: request.id, result: `0x${beacon.slice(2).padStart(64, "0")}` });
    }
    expect(request.method).toBe("eth_getCode");
    expect(request.params[0]).toMatch(/^0x[0-9a-fA-F]{40}$/);
    return Response.json({ jsonrpc: "2.0", id: request.id, result: deployed ? "0x6000" : "0x" });
  });
}

afterEach(() => vi.restoreAllMocks());

const ERC20_APPROVE_ABI = [
  {
    name: "approve",
    type: "function",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

const ERC1155_SET_APPROVAL_FOR_ALL_ABI = [
  {
    name: "setApprovalForAll",
    type: "function",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
] as const;

describe("buildDepositWalletApprovalCalls", () => {
  test("includes collateral approve and CTF setApprovalForAll for each trade spender", () => {
    const calls = buildDepositWalletApprovalCalls();
    const spenders = new Set(polymarketTradeSpenders().map(a => a.toLowerCase()));

    const usdcApproves = new Set<string>();
    const pusdApproves = new Set<string>();
    const ctfApprovals = new Set<string>();

    for (const call of calls) {
      const target = call.target.toLowerCase();
      if (target === POLYGON_POLYMARKET.USDC.toLowerCase()) {
        const decoded = decodeFunctionData({ abi: ERC20_APPROVE_ABI, data: call.data as `0x${string}` });
        expect(decoded.functionName).toBe("approve");
        usdcApproves.add(String(decoded.args[0]).toLowerCase());
      }
      else if (target === POLYGON_POLYMARKET.PUSD.toLowerCase()) {
        const decoded = decodeFunctionData({ abi: ERC20_APPROVE_ABI, data: call.data as `0x${string}` });
        expect(decoded.functionName).toBe("approve");
        pusdApproves.add(String(decoded.args[0]).toLowerCase());
      }
      else if (target === POLYGON_POLYMARKET.CTF.toLowerCase()) {
        const decoded = decodeFunctionData({
          abi: ERC1155_SET_APPROVAL_FOR_ALL_ABI,
          data: call.data as `0x${string}`,
        });
        expect(decoded.functionName).toBe("setApprovalForAll");
        expect(decoded.args[1]).toBe(true);
        ctfApprovals.add(String(decoded.args[0]).toLowerCase());
      }
      else {
        throw new Error(`unexpected call target ${call.target}`);
      }
    }

    expect(usdcApproves.has(POLYGON_POLYMARKET.CTF.toLowerCase())).toBe(true);
    expect(pusdApproves.has(POLYGON_POLYMARKET.CTF.toLowerCase())).toBe(true);
    for (const spender of spenders) {
      expect(usdcApproves.has(spender)).toBe(true);
      expect(pusdApproves.has(spender)).toBe(true);
      expect(ctfApprovals.has(spender)).toBe(true);
    }
    expect(ctfApprovals.has(POLYGON_POLYMARKET.CTF_EXCHANGE.toLowerCase())).toBe(true);
    expect(ctfApprovals.has(POLYGON_POLYMARKET.NEG_RISK_EXCHANGE.toLowerCase())).toBe(true);
    expect(ctfApprovals.has(POLYGON_POLYMARKET.CTF_COLLATERAL_ADAPTER.toLowerCase())).toBe(true);
    expect(ctfApprovals.has(POLYGON_POLYMARKET.NEG_RISK_CTF_COLLATERAL_ADAPTER.toLowerCase())).toBe(true);
    // Deposit Wallet allowlist 不含 V1 Exchange / V1 Neg Risk Adapter
    expect(usdcApproves.has(POLYGON_POLYMARKET.CTF_EXCHANGE_V1.toLowerCase())).toBe(false);
    expect(usdcApproves.has(POLYGON_POLYMARKET.NEG_RISK_EXCHANGE_V1.toLowerCase())).toBe(false);
    expect(usdcApproves.has(POLYGON_POLYMARKET.NEG_RISK_ADAPTER_V1.toLowerCase())).toBe(false);
    expect(ctfApprovals.has(POLYGON_POLYMARKET.NEG_RISK_ADAPTER_V1.toLowerCase())).toBe(false);
  });

  test("matches legacy Safe/Proxy approval calldata targets", () => {
    const legacy = buildStandardApprovalTransactions();
    const deposit = buildDepositWalletApprovalCalls();
    expect(deposit.length).toBe(legacy.length);
    for (let i = 0; i < legacy.length; i += 1) {
      expect(deposit[i]!.target.toLowerCase()).toBe(legacy[i]!.to.toLowerCase());
      expect(deposit[i]!.data).toBe(legacy[i]!.data);
    }
  });
});

describe("polygonRpc", () => {
  test("prefers configured RPC_URL (official env name)", () => {
    const prevRpc = process.env.RPC_URL;
    const prevPoly = process.env.POLYGON_RPC_URL;
    delete process.env.POLYGON_RPC_URL;
    process.env.RPC_URL = "https://example-rpc.test";
    try {
      expect(resolvePolygonRpcUrls()[0]).toBe("https://example-rpc.test");
      expect(resolvePolygonRpcUrls().slice(1)).toEqual([...POLYGON_RPC_URLS]);
    }
    finally {
      if (prevRpc === undefined)
        delete process.env.RPC_URL;
      else
        process.env.RPC_URL = prevRpc;
      if (prevPoly === undefined)
        delete process.env.POLYGON_RPC_URL;
      else
        process.env.POLYGON_RPC_URL = prevPoly;
    }
  });
});

describe("createPolymarketRelayClient", () => {
  test("patches publicClient so deriveDepositWalletAddress works with multi-RPC", async () => {
    const rpc = mockFactoryRpc();
    const client = await createPolymarketRelayClient({
      privateKey: "0x1111111111111111111111111111111111111111111111111111111111111111",
    });
    const transport = (client as { publicClient: { transport: { type?: string } } }).publicClient.transport;
    expect(transport.type).toBe("fallback");
    const funder = await client.deriveDepositWalletAddress();
    expect(funder).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(rpc).toHaveBeenCalledTimes(1);
  }, 30_000);
});

describe("derivePolymarketDepositWalletAddress", () => {
  test("returns a deposit wallet address via official RelayClient", async () => {
    const rpc = mockFactoryRpc();
    const funder = await derivePolymarketDepositWalletAddress({
      privateKey: "0x2222222222222222222222222222222222222222222222222222222222222222",
    });
    expect(funder).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(rpc).toHaveBeenCalledTimes(1);
  }, 30_000);

  test("uses beacon derivation for a new wallet and retains an already deployed UUPS wallet", async () => {
    const input = { privateKey: `0x${"2".repeat(64)}` };
    const rpc = mockFactoryRpc();
    const uups = await derivePolymarketDepositWalletAddress(input);
    rpc.mockRestore();
    const beaconRpc = mockFactoryRpc(FIXTURE_BEACON);
    const beacon = await derivePolymarketDepositWalletAddress(input);
    expect(beacon).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(beacon).not.toBe(uups);
    expect(beaconRpc).toHaveBeenCalledTimes(2);
    beaconRpc.mockRestore();
    const deployedRpc = mockFactoryRpc(FIXTURE_BEACON, true);
    expect(await derivePolymarketDepositWalletAddress(input)).toBe(uups);
    expect(deployedRpc).toHaveBeenCalledTimes(2);
  });

  // Explicit read-only online smoke remains available without making every
  // offline frontend run depend on public Polygon RPC health.
  test.runIf(process.env.POLYMARKET_WALLET_LIVE_RPC === "1")("live RPC smoke derives through official RelayClient", async () => {
    expect(await derivePolymarketDepositWalletAddress({ privateKey: `0x${"2".repeat(64)}` }))
      .toMatch(/^0x[0-9a-fA-F]{40}$/);
  }, 30_000);
});
