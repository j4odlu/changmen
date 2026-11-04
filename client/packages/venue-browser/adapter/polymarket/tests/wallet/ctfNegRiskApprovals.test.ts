import { beforeEach, expect, test, vi } from "vitest";
import { maxUint256 } from "viem";
import { POLYGON_POLYMARKET as contracts } from "@changmen/venue-browser/polymarket/wallet/contracts";
import { ensureCtfNegRiskApprovals } from "../../../../polymarket/wallet/ctfNegRiskApprovals";

const readContract = vi.hoisted(() => vi.fn());
vi.mock("viem", async importOriginal => ({ ...await importOriginal<typeof import("viem")>(), createPublicClient: () => ({ readContract }) }));
const wallet = "0x0000000000000000000000000000000000000001";
const wait = vi.fn(async () => undefined);
const approveErc20 = vi.fn(async (_request: unknown) => ({ wait }));
const approveErc1155ForAll = vi.fn(async (_request: unknown) => ({ wait }));
const client = { account: { wallet }, approveErc20, approveErc1155ForAll } as unknown as Parameters<typeof ensureCtfNegRiskApprovals>[0];
beforeEach(() => { vi.clearAllMocks(); readContract.mockReset(); });

test.each([[0n, false, 2], [maxUint256, false, 1], [0n, true, 1]] as const)("only supplements missing permissions (%s, %s)", async (allowance, approved, transactions) => {
  readContract.mockResolvedValueOnce(allowance).mockResolvedValueOnce(approved)
    .mockResolvedValueOnce(maxUint256).mockResolvedValueOnce(true);
  await ensureCtfNegRiskApprovals(client);
  expect(wait).toHaveBeenCalledTimes(transactions);
  expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "allowance", address: contracts.PUSD, args: [wallet, contracts.NEG_RISK_ADAPTER_V1] }));
  expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "isApprovedForAll", address: contracts.CTF, args: [wallet, contracts.NEG_RISK_ADAPTER_V1] }));
  if (allowance < maxUint256)
    expect(approveErc20).toHaveBeenCalledWith({ tokenAddress: contracts.PUSD, spenderAddress: contracts.NEG_RISK_ADAPTER_V1, amount: "max" });
  else expect(approveErc20).not.toHaveBeenCalled();
  if (!approved)
    expect(approveErc1155ForAll).toHaveBeenCalledWith({ tokenAddress: contracts.CTF, operatorAddress: contracts.NEG_RISK_ADAPTER_V1, approved: true });
  else expect(approveErc1155ForAll).not.toHaveBeenCalled();
});

test("existing permissions cause no transactions", async () => {
  readContract.mockResolvedValueOnce(maxUint256).mockResolvedValueOnce(true);
  await ensureCtfNegRiskApprovals(client);
  expect(approveErc20).not.toHaveBeenCalled();
  expect(approveErc1155ForAll).not.toHaveBeenCalled();
});

test("an RPC read failure prevents transactions", async () => {
  readContract.mockRejectedValue(new Error("RPC unavailable"));
  await expect(ensureCtfNegRiskApprovals(client)).rejects.toThrow("RPC unavailable");
  expect(approveErc20).not.toHaveBeenCalled();
  expect(approveErc1155ForAll).not.toHaveBeenCalled();
});

test("a mined call without the required on-chain permissions is not ready", async () => {
  readContract.mockResolvedValueOnce(0n).mockResolvedValueOnce(false)
    .mockResolvedValueOnce(0n).mockResolvedValueOnce(false);
  await expect(ensureCtfNegRiskApprovals(client)).rejects.toThrow("授权尚未确认");
});

test("a failed receipt prevents subsequent approvals and readiness", async () => {
  readContract.mockResolvedValueOnce(0n).mockResolvedValueOnce(false);
  wait.mockRejectedValueOnce(new Error("transaction reverted"));
  await expect(ensureCtfNegRiskApprovals(client)).rejects.toThrow("transaction reverted");
  expect(approveErc1155ForAll).not.toHaveBeenCalled();
});
