import { decodeFunctionData } from "viem";
import { describe, expect, test } from "vitest";
import { POLYGON_POLYMARKET, polymarketTradeSpenders } from "@changmen/venue-browser/polymarket/wallet/contracts";
import { buildStandardApprovalTransactions } from "@changmen/venue-browser/polymarket/wallet/relayer";

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

describe("buildStandardApprovalTransactions", () => {
  test("includes collateral approve and CTF setApprovalForAll for each trade spender", () => {
    const txs = buildStandardApprovalTransactions();
    const spenders = new Set(polymarketTradeSpenders().map(a => a.toLowerCase()));

    const usdcApproves = new Set<string>();
    const pusdApproves = new Set<string>();
    const ctfApprovals = new Set<string>();

    for (const tx of txs) {
      const to = tx.to.toLowerCase();
      if (to === POLYGON_POLYMARKET.USDC.toLowerCase()) {
        const decoded = decodeFunctionData({ abi: ERC20_APPROVE_ABI, data: tx.data as `0x${string}` });
        expect(decoded.functionName).toBe("approve");
        usdcApproves.add(String(decoded.args[0]).toLowerCase());
      }
      else if (to === POLYGON_POLYMARKET.PUSD.toLowerCase()) {
        const decoded = decodeFunctionData({ abi: ERC20_APPROVE_ABI, data: tx.data as `0x${string}` });
        expect(decoded.functionName).toBe("approve");
        pusdApproves.add(String(decoded.args[0]).toLowerCase());
      }
      else if (to === POLYGON_POLYMARKET.CTF.toLowerCase()) {
        const decoded = decodeFunctionData({
          abi: ERC1155_SET_APPROVAL_FOR_ALL_ABI,
          data: tx.data as `0x${string}`,
        });
        expect(decoded.functionName).toBe("setApprovalForAll");
        expect(decoded.args[1]).toBe(true);
        ctfApprovals.add(String(decoded.args[0]).toLowerCase());
      }
      else {
        throw new Error(`unexpected tx target ${tx.to}`);
      }
    }

    // 买：USDC/pUSD → CTF + 各 Exchange
    expect(usdcApproves.has(POLYGON_POLYMARKET.CTF.toLowerCase())).toBe(true);
    expect(pusdApproves.has(POLYGON_POLYMARKET.CTF.toLowerCase())).toBe(true);
    for (const spender of spenders) {
      expect(usdcApproves.has(spender)).toBe(true);
      expect(pusdApproves.has(spender)).toBe(true);
      // 卖：一次 setApprovalForAll 覆盖全部 outcome token
      expect(ctfApprovals.has(spender)).toBe(true);
    }

    expect(ctfApprovals.has(POLYGON_POLYMARKET.CTF_EXCHANGE.toLowerCase())).toBe(true);
    expect(ctfApprovals.has(POLYGON_POLYMARKET.NEG_RISK_EXCHANGE.toLowerCase())).toBe(true);
    expect(ctfApprovals.has(POLYGON_POLYMARKET.CTF_COLLATERAL_ADAPTER.toLowerCase())).toBe(true);
    expect(ctfApprovals.has(POLYGON_POLYMARKET.NEG_RISK_CTF_COLLATERAL_ADAPTER.toLowerCase())).toBe(true);
    expect(usdcApproves.has(POLYGON_POLYMARKET.CTF_EXCHANGE_V1.toLowerCase())).toBe(false);
    expect(usdcApproves.has(POLYGON_POLYMARKET.NEG_RISK_EXCHANGE_V1.toLowerCase())).toBe(false);
    expect(usdcApproves.has(POLYGON_POLYMARKET.NEG_RISK_ADAPTER_V1.toLowerCase())).toBe(false);
    expect(ctfApprovals.has(POLYGON_POLYMARKET.NEG_RISK_ADAPTER_V1.toLowerCase())).toBe(false);
  });
});
