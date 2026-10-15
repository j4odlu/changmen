import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("account betGateway", () => {
  it("does not unlock during PM precheck or submission", () => {
    const source = readFileSync(join(process.cwd(), "src/stores/account/betGateway.ts"), "utf8");
    expect(source).toMatch(/async function ensureSharedVaultKeyForAccount/);
    expect(source).toMatch(/mergeVaultKeysIntoAccounts\(accountStore\.accounts, uid\)/);
    expect(source).toMatch(/account\.token = shared\.token/);

    const checkAt = source.indexOf("export async function checkBetting");
    const checkSource = source.slice(checkAt, source.indexOf("export async function placeBet"));
    expect(checkSource).toContain('if (pm) getRetainedPmPrivateKey(account.accountId)');
    expect(checkSource).toContain('else await ensureSharedVaultKeyForAccount(account)');
    expect(checkSource).not.toContain('prepareSigning:');

    const placeAt = source.indexOf("export async function placeBet");
    const placeHydrateAt = source.indexOf("await ensureSharedVaultKeyForAccount(account);", placeAt);
    const placeProviderAt = source.indexOf("const provider = getProvider(account);", placeAt);
    expect(source).toContain('if (account.provider !== "Polymarket" && !opts?.requirePreparedQuote) await ensureSharedVaultKeyForAccount(account);');
    expect(placeHydrateAt).toBeGreaterThan(placeAt);
    expect(placeHydrateAt).toBeLessThan(placeProviderAt);
  });
});
