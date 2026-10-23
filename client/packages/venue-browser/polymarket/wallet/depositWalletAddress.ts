import {
  concat, createPublicClient, encodeAbiParameters, getCreate2Address, keccak256, pad, toHex, zeroAddress,
  type Address, type Hex,
} from "viem";
import { createPolygonHttpTransport, polygonChainForRpc } from "./polygonRpc";

// [changmen 扩展] 与当前官方 builder-relayer-client@0.0.10 的 Polygon 配置、
// Solady v0.1.26 initCodeHashERC1967 / Beacon 及地址选择顺序保持一致。
// https://github.com/Polymarket/builder-relayer-client/blob/main/src/builder/derive.ts
// https://github.com/Polymarket/builder-relayer-client/blob/main/src/client.ts
const FACTORY: Address = "0x00000000000Fb5C9ADea0298D729A0CB3823Cc07";
const IMPLEMENTATION: Address = "0x58CA52ebe0DadfdF531Cde7062e76746de4Db1eB";
const FACTORY_BEACON_SELECTOR = "0x49493a4d";

function depositWalletAddress(owner: Address, implementation: Address, beacon: boolean): Address {
  const args = encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [FACTORY, pad(owner, { size: 32 })]);
  const length = BigInt((args.length - 2) / 2);
  const prefix = toHex((beacon ? 0x6100523d8160233d3973n : 0x61003d3d8160233d3973n) + (length << 56n), { size: 10 });
  const bytecode: Hex = beacon
    ? concat([prefix, implementation,
        "0x60195155f3363d3d373d3d363d602036600436635c60da",
        "0x1b60e01b36527fa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6c",
        "0xb3582b35133d50545afa5036515af43d6000803e604d573d6000fd5b3d6000f3", args])
    : concat([prefix, implementation, "0x6009",
        "0x5155f3363d3d373d3d363d7f360894a13ba1a3210667c828492db98dca3e2076",
        "0xcc3735a920a3ca505d382bbc545af43d6000803e6038573d6000fd5b3d6000f3", args]);
  return getCreate2Address({ from: FACTORY, salt: keccak256(args), bytecodeHash: keccak256(bytecode) });
}

async function factoryBeacon(client: ReturnType<typeof createPublicClient>): Promise<Address> {
  // RPC 失败（包括 revert）继续上抛，不能用失败响应猜测钱包地址。
  // 只有成功读取出的零 beacon 或短返回才按旧工厂处理。
  const { data } = await client.call({ to: FACTORY, data: FACTORY_BEACON_SELECTOR });
  // 官方 SDK 对缺失/短返回按未升级工厂处理；保留其最后 20 字节解码规则。
  return data === undefined || data.length < 66 ? zeroAddress : `0x${data.slice(-40)}`;
}

/** [changmen 扩展] 只读派生 Deposit Wallet；无需创建钱包客户端或加载旧 Relayer SDK。 */
export async function deriveDepositWalletAddress(owner: Address): Promise<Address> {
  const client = createPublicClient({ chain: polygonChainForRpc(), transport: createPolygonHttpTransport() });
  const uups = depositWalletAddress(owner, IMPLEMENTATION, false);
  const beacon = await factoryBeacon(client);
  if (beacon.toLowerCase() === zeroAddress)
    return uups;
  const code = await client.getCode({ address: uups });
  if (code !== undefined && code !== "0x")
    return uups;
  return depositWalletAddress(owner, beacon, true);
}
