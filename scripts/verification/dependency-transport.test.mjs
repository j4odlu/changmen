// [changmen 扩展] Native patched transports preserve signed request bytes and UUID consumer APIs.
import assert from "node:assert/strict";
import {historicalCreateRequire as createRequire} from './workspace-layout-history.mjs';
import { createServer } from "node:http";
import { once } from "node:events";
import { it } from "vitest";
const require = createRequire(import.meta.url);
const clobRequire = createRequire(require.resolve("@polymarket/clob-client-v2"));
const sdkAxios = clobRequire("axios");

for (const [name, axios] of [["Polymarket CLOB Axios 1.20", sdkAxios]])
  it(`${name}: preserves signed JSON, auth headers, query and HTTP error evidence`, async () => {
    const requests = [];
    const server = createServer(async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      requests.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      res.setHeader("connection", "close"); res.setHeader("content-type", "application/json");
      res.statusCode = req.url === "/rejected" ? 400 : 200;
      res.end(JSON.stringify(req.url === "/rejected" ? { error: "fixture-rejection" } : { orderID: "fixture-order", status: "matched" }));
    });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    try {
      const client = axios.create({ baseURL: `http://127.0.0.1:${server.address().port}`, proxy: false, timeout: 5000 });
      const payload = { orderType: "FOK", order: { salt: "123456789123456789", tokenId: "987654321987654321",
        side: "BUY", price: "0.30", size: "4.00", signature: "fixture-signature" } };
      const headers = { POLY_BUILDER_API_KEY: "fixture-key", POLY_BUILDER_SIGNATURE: "fixture-hmac", POLY_BUILDER_TIMESTAMP: "1234567890" };
      const response = await client.post("/submit", payload, { headers, params: { kind: "FOK", owner: "fixture" } });
      assert.deepEqual(response.data, { orderID: "fixture-order", status: "matched" });
      assert.equal(requests[0].url, "/submit?kind=FOK&owner=fixture");
      assert.equal(requests[0].body, JSON.stringify(payload));
      for (const [key, value] of Object.entries(headers)) assert.equal(requests[0].headers[key.toLowerCase()], value);
      await assert.rejects(client.get("/rejected"), error => axios.isAxiosError(error)
        && error.response.status === 400 && error.response.data.error === "fixture-rejection");
      assert.equal(requests.length, 2);
    } finally {
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    }
  }, 15000);

it("the existing SocketCluster CJS UUID consumer retains its v4 API", () => {
  const uuid = createRequire(require.resolve("socketcluster-client"))("uuid");
  const value = uuid.v4(); assert(uuid.validate(value)); assert.equal(uuid.version(value), 4);
});
