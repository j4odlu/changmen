import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  parseSxBetTokenConfig,
  resolveSxBetApiKey,
  resolveSxBetPrivateKey,
} from "./credentials";
import {
  parseSxTradeNetReturnUsdc,
  parseSxTradeStakeUsdc,
  sxUsdcToWei,
  sxWeiToUsdc,
} from "./orders";
import {
  applySxBestOddsWsUpdate,
  sxDecimalToProtocolOdds,
  sxDesiredProtocolOddsFromBestRow,
} from "./parse";

describe("sxbet credentials", () => {
  it("parses json token config", () => {
    const cfg = parseSxBetTokenConfig(JSON.stringify({
      privateKey: "abc123",
      apiKey: "sx-key",
    }));
    assert.equal(resolveSxBetPrivateKey(cfg), "0xabc123");
    assert.equal(resolveSxBetApiKey(cfg), "sx-key");
  });

  it("treats bare 0x key as privateKey", () => {
    const cfg = parseSxBetTokenConfig(`0x${"ab".repeat(32)}`);
    assert.ok(resolveSxBetPrivateKey(cfg).startsWith("0x"));
  });

  it("treats bare 64-hex (no 0x) as privateKey", () => {
    const cfg = parseSxBetTokenConfig("ab".repeat(32));
    assert.equal(resolveSxBetPrivateKey(cfg), `0x${"ab".repeat(32)}`);
  });
});

describe("sxbet orders units", () => {
  it("converts usdc <-> wei", () => {
    assert.equal(sxUsdcToWei(50), "50000000");
    assert.equal(sxWeiToUsdc("50000000"), 50);
  });

  it("parses trade stake/netReturn units", () => {
    assert.equal(parseSxTradeStakeUsdc({ stake: "1035620", normalizedStake: 1 }), 1);
    assert.equal(parseSxTradeStakeUsdc({ stake: "1035620" }), 1.03562);
    assert.equal(parseSxTradeNetReturnUsdc("2.035617"), 2.035617);
    assert.equal(parseSxTradeNetReturnUsdc(0), 0);
  });
});

describe("sxbet best odds ws merge", () => {
  it("applies newer updates and ignores stale", () => {
    const first = applySxBestOddsWsUpdate(undefined, {
      marketHash: "0xabc",
      isMakerBettingOutcomeOne: true,
      percentageOdds: "50000000000000000000",
      updatedAt: 100,
    });
    assert.equal(first.outcomeOne?.percentageOdds, "50000000000000000000");
    const stale = applySxBestOddsWsUpdate(first, {
      marketHash: "0xabc",
      isMakerBettingOutcomeOne: true,
      percentageOdds: "40000000000000000000",
      updatedAt: 50,
    });
    assert.equal(stale.outcomeOne?.percentageOdds, "50000000000000000000");
    const newer = applySxBestOddsWsUpdate(first, {
      marketHash: "0xabc",
      isMakerBettingOutcomeOne: false,
      percentageOdds: "45000000000000000000",
      updatedAt: 200,
    });
    assert.equal(newer.outcomeTwo?.percentageOdds, "45000000000000000000");
    assert.equal(sxDecimalToProtocolOdds(2), "50000000000000000000");
  });

  it("derives desiredOdds from best row without decimal roundtrip", () => {
    const row = {
      outcomeOne: { percentageOdds: "63375000000000000000" },
      outcomeTwo: { percentageOdds: "32375000000000000000" },
    };
    // taker on outcome one = 1e20 - makerTwo
    assert.equal(
      sxDesiredProtocolOddsFromBestRow(row, true),
      (10n ** 20n - 32375000000000000000n).toString(),
    );
  });
});
