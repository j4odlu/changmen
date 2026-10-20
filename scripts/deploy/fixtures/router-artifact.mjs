import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COMPILED_PAIRS } from "../../../server/backend/scripts/ensure-router-compiled.mjs";

export function routerArtifactFixture(root) {
  const files = { "server/backend/tsconfig.json": "{}",
    "server/backend/tsconfig.router.json": JSON.stringify({ compilerOptions: {
      target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", types: [],
    }, files: COMPILED_PAIRS.map(([ts]) => `core/esport-api/${ts}`) }) };
  for (const [ts] of COMPILED_PAIRS) files[`server/backend/core/esport-api/${ts}`] = "export const value: number = 42;\n";
  for (const [file, value] of Object.entries(files)) {
    const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, value);
  }
  if (!fs.existsSync(path.join(root, "node_modules"))) fs.symlinkSync(
    fileURLToPath(new URL("../../../node_modules", import.meta.url)), path.join(root, "node_modules"), "junction");
  fs.appendFileSync(path.join(root, ".gitignore"), "\nnode_modules/\n");
  return files;
}
