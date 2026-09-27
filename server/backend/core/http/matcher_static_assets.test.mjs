import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "vitest";
import { createStaticHandler } from "../../static_files.js";

let tempDir;
let server;
let origin;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "changmen-matcher-assets-"));
  const webDir = path.join(tempDir, "web");
  const matcherDir = path.join(tempDir, "matcher");
  const publicDir = path.join(tempDir, "public");
  await fs.mkdir(path.join(webDir, "assets", "venue"), { recursive: true });
  await fs.mkdir(path.join(webDir, "assets", "games"), { recursive: true });
  await fs.mkdir(matcherDir, { recursive: true });
  await fs.mkdir(publicDir, { recursive: true });
  await fs.writeFile(path.join(webDir, "assets", "venue", "ob.png"), "venue-icon");
  await fs.writeFile(path.join(webDir, "assets", "games", "cs2.svg"), "<svg/>");
  await fs.writeFile(path.join(matcherDir, "index.html"), "matcher");

  const serveStatic = createStaticHandler({ publicDir, webDir, matcherDir });
  server = http.createServer(serveStatic);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  origin = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  if (server)
    await new Promise(resolve => server.close(resolve));
  if (tempDir)
    await fs.rm(tempDir, { recursive: true, force: true });
});

describe("matcher static assets", () => {
  it("serves venue icons below the matcher reverse-proxy prefix", async () => {
    const response = await fetch(`${origin}/matcher/assets/venue/ob.png`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(await response.text(), "venue-icon");
  });

  it("serves game icons below the matcher reverse-proxy prefix", async () => {
    const response = await fetch(`${origin}/matcher/assets/games/cs2.svg`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/svg+xml");
    assert.equal(await response.text(), "<svg/>");
  });
});
