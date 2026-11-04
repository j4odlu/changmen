import type { SecureClient } from "@polymarket/client";
import { createPublicClient, erc20Abi, erc1155Abi, maxUint256, type Address } from "viem";
import { POLYGON_POLYMARKET as contracts } from "./contracts";
import { createPolygonHttpTransport, polygonChainForRpc } from "./polygonRpc";

/**
 * SDK 0.12.0 的默认审批清单遗漏 CTF Neg Risk Adapter；保留 SDK 对 V2 的完整审批，补齐这两项。
 * https://docs.polymarket.com/resources/contracts#ctf
 * 旧 redeem 入口停用不代表此适配器的交易授权已退役。
 */
export async function ensureCtfNegRiskApprovals(
  client: Pick<SecureClient, "account" | "approveErc20" | "approveErc1155ForAll">,
): Promise<void> {
  const rpc = createPublicClient({ chain: polygonChainForRpc(), transport: createPolygonHttpTransport() });
  const wallet = String(client.account.wallet) as Address;
  const adapter = contracts.NEG_RISK_ADAPTER_V1;
  const readState = () => Promise.all([
    rpc.readContract({ address: contracts.PUSD, abi: erc20Abi, functionName: "allowance", args: [wallet, adapter] }),
    rpc.readContract({ address: contracts.CTF, abi: erc1155Abi, functionName: "isApprovedForAll", args: [wallet, adapter] }),
  ]);
  const [allowance, approved] = await readState();
  if (allowance === maxUint256 && approved) return;
  // 同一 Deposit Wallet 的 relayer 操作顺序执行，避免并发 nonce 冲突。
  if (allowance < maxUint256) {
    const handle = await client.approveErc20({ tokenAddress: contracts.PUSD, spenderAddress: adapter, amount: "max" });
    await handle.wait();
  }
  if (!approved) {
    const handle = await client.approveErc1155ForAll({ tokenAddress: contracts.CTF, operatorAddress: adapter, approved: true });
    await handle.wait();
  }
  const [confirmedAllowance, confirmedApproval] = await readState();
  if (confirmedAllowance !== maxUint256 || !confirmedApproval)
    throw new Error("CTF 负风险适配器授权尚未确认，请重试账号准备");
}
