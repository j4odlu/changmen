import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("account betGateway", () => {
  it("hydrates shared vault keys before any venue check or bet", () => {
    const source = readFileSync(join(process.cwd(), "src/stores/account/betGateway.ts"), "utf8");
    expect(source).toMatch(/async function ensureSharedVaultKeyForAccount/);
    expect(source).toMatch(/mergeVaultKeysIntoAccounts\(accountStore\.accounts, uid\)/);
    expect(source).toMatch(/account\.token = shared\.token/);

    const checkAt = source.indexOf("export async function checkBetting");
    const checkHydrateAt = source.indexOf("const signingReady = await ensureSharedVaultKeyForAccount(account);", checkAt);
    const checkProviderAt = source.indexOf("const provider = getProvider(account);", checkAt);
    expect(checkHydrateAt).toBeGreaterThan(checkAt);
    expect(checkHydrateAt).toBeLessThan(checkProviderAt);
    const checkSigningAt = source.indexOf("account.provider === \"Polymarket\" && !signingReady", checkAt);
    const checkVenueAt = source.indexOf("await provider.checkBet(account, option);", checkAt);
    expect(checkSigningAt).toBeGreaterThan(checkProviderAt);
    expect(checkSigningAt).toBeLessThan(checkVenueAt);

    const placeAt = source.indexOf("export async function placeBet");
    const placeHydrateAt = source.indexOf("await ensureSharedVaultKeyForAccount(account);", placeAt);
    const placeProviderAt = source.indexOf("const provider = getProvider(account);", placeAt);
    expect(placeHydrateAt).toBeGreaterThan(placeAt);
    expect(placeHydrateAt).toBeLessThan(placeProviderAt);
  });
});
