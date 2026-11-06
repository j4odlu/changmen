import path from "node:path";
import type { Plugin } from "vite";
/** Keep Vite's dependency URL normalization off the HTML entry boundary.
 * A raw loader imports the bundled entry through the same normalization path as
 * lazy chunks, so the entry cannot execute twice under URLs with/without ?v.
 */
export function localBootstrap(): Plugin {
  return {
    name: "listener-local-bootstrap",
    enforce: "post",
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        const entry = Object.values(bundle).find(item => item.type === "chunk" && item.isEntry);
        const html = bundle["index.html"];
        if (!entry || entry.type !== "chunk" || !html || html.type !== "asset") this.error("Listener HTML entry missing");
        const fileName = `node_modules/listener-assets/bootstrap-${path.posix.basename(entry.fileName)}`;
        const relative = path.posix.relative(path.posix.dirname(fileName), entry.fileName);
        const source = String(html.source);
        if (!source.includes(entry.fileName)) this.error("Listener entry script missing");
        html.source = source.replace(entry.fileName, fileName);
        this.emitFile({ type: "asset", fileName, source: `import(${JSON.stringify(`./${relative}`)});\n` });
      },
    },
  };
}
