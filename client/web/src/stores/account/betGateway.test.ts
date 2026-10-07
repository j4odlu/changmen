import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("account betGateway", () => {
  it("starts vault preparation with PM public precheck and does not unlock at PM submission", () => {
    const source = readFileSync(join(process.cwd(), "src/stores/account/betGateway.ts"), "utf8");
    expect(source).toMatch(/async function ensureSharedVaultKeyForAccount/);
    expect(source).toMatch(/mergeVaultKeysIntoAccounts\(accountStore\.accounts, uid\)/);
    expect(source).toMatch(/account\.token = shared\.token/);

    const checkAt = source.indexOf("export async function checkBetting");
    const signingTaskAt = source.indexOf("const signingTask =", checkAt);
    const checkVenueAt = source.indexOf("await provider.checkBet(account, option,", checkAt);
    expect(signingTaskAt).toBeGreaterThan(checkAt);
    expect(checkVenueAt).toBeGreaterThan(signingTaskAt);
    expect(source).toContain('prepareSigning: signingTask');
    expect(source).toContain('if (!pm) await signingTask');
    expect(source).toContain('pm && opts?.role === "precheckOnly"');

    const placeAt = source.indexOf("export async function placeBet");
    const placeHydrateAt = source.indexOf("await ensureSharedVaultKeyForAccount(account);", placeAt);
    const placeProviderAt = source.indexOf("const provider = getProvider(account);", placeAt);
    expect(source).toContain('if (account.provider !== "Polymarket") await ensureSharedVaultKeyForAccount(account);');
    expect(placeHydrateAt).toBeGreaterThan(placeAt);
    expect(placeHydrateAt).toBeLessThan(placeProviderAt);
  });
});
