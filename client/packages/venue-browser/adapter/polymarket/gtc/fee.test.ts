import { expect, it } from "vitest";
import { parseGtcFeeProof } from "@changmen/venue-browser/polymarket/gtc/fee";

it.each([0, "0", 0.05, "0.05"])("accepts a real numeric fee rate including zero: %j", r => {
  expect(parseGtcFeeProof({ r, e: 1, to: true })).toMatchObject({ rate: Number(r).toFixed(6), exponent: 1, takerOnly: true });
});
it.each([undefined, null, "", " ", false, true, [], {}, "0x0", "0b0", "NaN", "Infinity", -1])("does not coerce malformed or unknown rates into fee proof: %j", r => {
  expect(parseGtcFeeProof({ r, e: 1, to: true })).toBeUndefined();
});
it.each([undefined, null, "", true, [], 2])("rejects unsupported or malformed fee curves: %j", e => {
  expect(parseGtcFeeProof({ r: 0.05, e, to: true })).toBeUndefined();
});
