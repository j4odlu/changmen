import { decodeFunctionData } from "viem";
import { describe, expect, test } from "vitest";
import { POLYGON_POLYMARKET, polymarketTradeSpenders } from "../../contracts";
import {
  buildDepositWalletApprovalCalls,
  createPolymarketRelayClient,
  derivePolymarketDepositWalletAddress,
} from "../../depositWallet";
import { buildStandardApprovalTransactions } from "../../relayer";
import {
  POLYGON_RPC_URLS,
  resolvePolygonRpcUrls,
} from "../../polygonRpc";

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
    const client = await createPolymarketRelayClient({
      privateKey: "0x1111111111111111111111111111111111111111111111111111111111111111",
    });
    const transport = (client as { publicClient: { transport: { type?: string } } }).publicClient.transport;
    expect(transport.type).toBe("fallback");
    const funder = await client.deriveDepositWalletAddress();
    expect(funder).toMatch(/^0x[0-9a-fA-F]{40}$/);
  }, 30_000);
});

describe("derivePolymarketDepositWalletAddress", () => {
  test("returns a deposit wallet address via official RelayClient", async () => {
    const funder = await derivePolymarketDepositWalletAddress({
      privateKey: "0x2222222222222222222222222222222222222222222222222222222222222222",
    });
    expect(funder).toMatch(/^0x[0-9a-fA-F]{40}$/);
  }, 30_000);
});
