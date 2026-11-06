import fs from "node:fs";
import path from "node:path";

/** Combine already-built entries; keep all hashed chunks under the retained assets root. */
export function assembleFrontend(webDist, listenerDist) {
  const html = fs.readFileSync(path.join(listenerDist, "index.html"), "utf8");
  const entry = html.match(/src="\/(assets\/listener\/[^"\s]+\.js)"/)?.[1];
  if (!entry || !fs.existsSync(path.join(listenerDist, entry))) throw Error("Missing production listener entry");
  const graph = JSON.parse(fs.readFileSync(path.join(listenerDist, "isolation-manifest.json"), "utf8"));
  if (!Array.isArray(graph.modules) || !graph.modules.length) throw Error("Missing listener graph evidence");
  fs.cpSync(path.join(listenerDist, "assets/listener"), path.join(webDist, "assets/listener"), { recursive: true });
  const target = path.join(webDist, "listener");
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, "index.html"), html);
  fs.copyFileSync(path.join(listenerDist, "isolation-manifest.json"), path.join(target, "isolation-manifest.json"));
  for (const file of ["runtime-version.json", "runtime-version.html"])
    fs.copyFileSync(path.join(webDist, file), path.join(target, file));
}
