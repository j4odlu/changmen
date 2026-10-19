import { describe, expect, it } from "vitest";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";

import {
  isPredictFunHousePlaceholderAccount,
  isPredictFunHouseMode,
  PREDICT_FUN_ACCOUNT_MODE,
  resolvePredictFunMasterCredentials,
} from "./masterAccount";

function accountWithToken(token: string): PlatformAccount {
  return {
    accountId: 1,
    platform: "PredictFun",
    token,
  } as PlatformAccount;
}

describe("predictfun masterAccount (house 已下线)", () => {
  it("exports house mode constant but mode flag is off", () => {
    expect(PREDICT_FUN_ACCOUNT_MODE).toBe("house");
    expect(isPredictFunHouseMode()).toBe(false);
  });

  it("resolves master credentials from account token with private key", () => {
    const master = resolvePredictFunMasterCredentials(
      accountWithToken(JSON.stringify({
        privateKey: "abc123",
        predictAccount: "0xDeposit",
      })),
    );
    expect(master).toEqual({
      privateKey: "0xabc123",
      predictAccount: "0xDeposit",
      privyPrivateKey: undefined,
      source: "account",
    });
  });

  it("returns null when house placeholder has no keys and env is unset", () => {
    const master = resolvePredictFunMasterCredentials(
      accountWithToken(JSON.stringify({ mode: "house" })),
    );
    expect(master).toBeNull();
  });

  it("treats house placeholder as placeholder when env would supply master", () => {
    const placeholder = accountWithToken(JSON.stringify({ mode: "house" }));
    // vitest 通常无 VITE_*；无 env 时 house 且无 key → 占位
    expect(isPredictFunHousePlaceholderAccount(placeholder)).toBe(true);
  });

  it("does not treat account with private key as placeholder", () => {
    const real = accountWithToken(JSON.stringify({ privateKey: "deadbeef" }));
    expect(isPredictFunHousePlaceholderAccount(real)).toBe(false);
  });
});
