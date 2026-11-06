import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createServer } from "vite";
import { expect, it } from "vitest";
import { listenerDev } from "./listenerDev";

it("serves current shared sources through isolated aliases and HMR on the original port", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "changmen-listener-dev-"));
  const web = path.join(root, "web"), listener = path.join(root, "listener");
  await fs.mkdir(web);
  await fs.mkdir(listener);
  await fs.writeFile(path.join(web, "index.html"), '<script type="module" src="/bootstrap.ts"></script>');
  await fs.writeFile(path.join(web, "bootstrap.ts"), 'import { value } from "./shared"; export const mode = "original"; console.log(value);');
  await fs.writeFile(path.join(web, "shared.ts"), 'export const value = "first";');
  await fs.writeFile(path.join(listener, "bootstrap.ts"), 'import { value } from "shared"; export const mode = "listener"; console.log(value);');
  const htmlFile = path.join(listener, "index.html");
  await fs.writeFile(htmlFile, '<div id="app"></div><script type="module" src="./bootstrap.ts"></script>');
  const configFile = path.join(root, "listener.config.mjs");
  await fs.writeFile(configFile, `export default ${JSON.stringify({
    root: listener, cacheDir: path.join(root, "cache"),
    resolve: { alias: { shared: path.join(web, "shared.ts") } },
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { fs: { allow: [root] } }, logLevel: "silent",
  })}`);
  const server = await createServer({
    configFile: false, root: web, logLevel: "silent",
    plugins: [listenerDev({ configFile, htmlFile })],
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { port: 0, host: "127.0.0.1" },
  });
  const sockets: WebSocket[] = [];
  try {
    await server.listen();
    const origin = `http://127.0.0.1:${(server.httpServer!.address() as AddressInfo).port}`;
    const read = async (url: string) => {
      const response = await fetch(origin + url);
      expect(response.status).toBe(200);
      return response.text();
    };
    expect(await read("/")).toContain('src="/bootstrap.ts"');
    // The listener compiler is lazy: an ordinary page request never reads its config.
    expect(await fs.stat(path.join(root, "cache")).catch(() => null)).toBeNull();
    for (const entry of ["/listener", "/listener/", "/listener.html", "/listener/index.html"]) {
      const html = await read(entry);
      expect(html).toContain('src="/__listener/@vite/client"');
      expect(html).toContain('src="/__listener/bootstrap.ts"');
      expect(html).not.toContain("build/dist");
    }
    expect(await read("/bootstrap.ts")).toContain('mode = "original"');
    const source = await read("/__listener/bootstrap.ts");
    expect(source).toContain('mode = "listener"');
    const sharedUrl = source.match(/from "([^"]*shared\.ts[^"]*)"/)?.[1];
    expect(sharedUrl).toMatch(/^\/__listener\//);
    const client = await read("/__listener/@vite/client");
    expect(client).toContain("/__listener/hmr");
    expect(await server.moduleGraph.getModuleByUrl("/__listener/bootstrap.ts")).toBeUndefined();
    const connectHmr = async (pathname: string) => {
      const socket = new WebSocket(origin.replace("http:", "ws:") + pathname, "vite-hmr");
      sockets.push(socket);
      const messages: string[] = [];
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("HMR connection timed out")), 5_000);
        socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("HMR connection failed")); });
        socket.addEventListener("message", (event) => {
          const message = String(event.data);
          messages.push(message);
          if (JSON.parse(message).type === "connected") { clearTimeout(timer); resolve(); }
        });
      });
      return messages;
    };
    const normalUpdates = await connectHmr("/");
    const listenerUpdates = await connectHmr("/__listener/hmr");
    const savedHtml = await fs.readFile(htmlFile, "utf8");
    await fs.unlink(htmlFile);
    expect((await fetch(origin + "/listener")).status).toBe(500);
    expect(await read("/")).toContain('src="/bootstrap.ts"');
    await fs.writeFile(htmlFile, savedHtml);
    expect(await read("/listener")).toContain('src="/__listener/bootstrap.ts"');
    expect(await read(sharedUrl!)).toContain('"first"');
    expect(await read("/shared.ts")).toContain('"first"');
    await fs.writeFile(path.join(web, "shared.ts"), 'export const value = "updated";');
    await expect.poll(() => read(sharedUrl!), { timeout: 5_000 }).toContain('"updated"');
    await expect.poll(() => read("/shared.ts"), { timeout: 5_000 }).toContain('"updated"');
    for (const messages of [normalUpdates, listenerUpdates]) {
      await expect.poll(() => messages.some(message => /"type":"(?:update|full-reload)"/.test(message)), { timeout: 5_000 }).toBe(true);
    }
    expect(normalUpdates.some(message => JSON.parse(message).type === "error")).toBe(false);
    expect(await read("/bootstrap.ts")).toContain('mode = "original"');
  } finally {
    for (const socket of sockets) socket.close();
    await server.close();
    // Only the explicitly created temporary fixture is removed.
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);

it("does not participate in production builds", () => {
  expect(listenerDev().apply).toBe("serve");
});
