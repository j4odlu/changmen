import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// Resolve through the server's actual Socket.IO consumer, not an unrelated copy.
const { Decoder, Encoder } = require(require.resolve("socket.io-parser", { paths: [require.resolve("socket.io")] }));

test("zero-attachment binary packets cannot retain subsequent data", () => {
  const decoder = new Decoder();
  assert.throws(() => decoder.add('50-["security-regression"]'), /Illegal attachments/);
  assert.equal(decoder.reconstructor, undefined);
  assert.throws(() => decoder.add(Buffer.alloc(1)), /not reconstructing/);
  decoder.destroy();
});
test("normal binary event round-trip and attachment bounds remain valid", () => {
  const decoder = new Decoder(), decoded = [];
  decoder.on("decoded", packet => decoded.push(packet));
  const packets = new Encoder().encode({ type: 2, nsp: "/", data: ["book", Buffer.from([1, 2, 3])] });
  for (const packet of packets) decoder.add(packet);
  assert.equal(decoded.length, 1); assert.equal(decoded[0].data[0], "book");
  assert.deepEqual(decoded[0].data[1], Buffer.from([1, 2, 3]));
  assert.throws(() => decoder.add('511-["security-regression"]'), /too many attachments/);
  decoder.destroy();
});
