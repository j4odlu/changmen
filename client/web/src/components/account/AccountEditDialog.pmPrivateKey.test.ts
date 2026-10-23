import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("AccountEditDialog PM private key input", () => {
  it("catches automatic signer-address derivation failures", () => {
    const file = readFileSync(
      join(process.cwd(), "src/components/account/polymarketAccountEditor.ts"),
      "utf8",
    );
    const start = file.indexOf("function syncPolymarketWalletAddressFromPrivateKey()");
    const end = file.indexOf("async function syncPolymarketDerivedAddresses", start);
    const block = file.slice(start, end);

    expect(block).toContain("resolvePolymarketSignerAddress(privateKey).then");
    expect(block).toContain(".catch(() =>");
  });
});
