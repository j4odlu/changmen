import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type Plugin, type ViteDevServer } from "vite";

const listenerRoot = fileURLToPath(new URL("../../../listener/", import.meta.url));
const sourceBase = "/__listener/";
const entries = new Set(["/listener", "/listener/", "/listener.html", "/listener/index.html"]);

/** A second module graph on the same HTTP server keeps listener aliases out of the original app. */
export function listenerDev(options: { configFile?: string; htmlFile?: string } = {}): Plugin {
  let pending: Promise<ViteDevServer> | undefined;
  let closing = false;
  return {
    name: "changmen-listener-dev",
    apply: "serve",
    configureServer(parent) {
      const getListener = () => {
        pending ??= createServer({
          configFile: options.configFile ?? path.join(listenerRoot, "build/vite.live.config.ts"),
          mode: parent.config.mode,
          base: sourceBase,
          server: {
            middlewareMode: true,
            // Both HMR clients use the existing port, with separate WebSocket paths.
            hmr: { server: parent.httpServer ?? undefined, path: "hmr" },
            watch: parent.config.server.watch,
          },
        }).then(async (server) => {
          if (closing) {
            await server.close();
            throw new Error("监听开发服务已关闭");
          }
          return server;
        }).catch((error: unknown) => {
          pending = undefined;
          throw error;
        });
        return pending;
      };
      parent.middlewares.use((req, res, next) => {
        const pathname = req.url?.split("?")[0] ?? "";
        const entry = entries.has(pathname);
        if (!entry && !pathname.startsWith(sourceBase)) return next();
        const fail = (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          parent.config.logger.error(`[listener] ${message}`);
          // Do not pass listener failures to the original app's error/HMR broadcast.
          if (res.headersSent) { res.destroy(); return; }
          res.statusCode = 500;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(`监听开发页面加载失败：${message}`);
        };
        void (async () => {
          const server = await getListener();
          if (!entry) {
            server.middlewares(req, res, (error?: unknown) => {
              if (error) return fail(error);
              res.statusCode = 404;
              res.end("Listener source not found");
            });
            return;
          }
          if (req.method !== "GET" && req.method !== "HEAD") {
            res.statusCode = 405;
            res.setHeader("Allow", "GET, HEAD");
            res.end();
            return;
          }
          const html = await fs.readFile(options.htmlFile ?? path.join(listenerRoot, "module/index.html"), "utf8");
          const page = await server.transformIndexHtml("/index.html",
            html.replace('src="./bootstrap.ts"', 'src="/bootstrap.ts"'));
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(req.method === "HEAD" ? undefined : page);
        })().catch(fail);
      });
    },
    async closeBundle() {
      closing = true;
      const server = await pending?.catch(() => undefined);
      await server?.close();
    },
  };
}
