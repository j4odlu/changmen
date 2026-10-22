import { rollup } from "rollup";
import type { OutputOptions } from "rollup";
import { expect, it } from "vitest";
import { acyclicChunks } from "./acyclicChunks";

async function generate(modules: Record<string, string>, output: OutputOptions = {}) {
  const bundle = await rollup({
    input: "entry",
    external: ["external"],
    onwarn() {},
    plugins: [{
      name: "chunk-graph-fixture",
      resolveId: id => Object.hasOwn(modules, id) ? id : null,
      load: id => modules[id],
    }, acyclicChunks()],
  });
  try {
    return await bundle.generate({ format: "es", ...output });
  }
  finally {
    await bundle.close();
  }
}

it("rejects emitted chunk cycles even when the source dependency graph is acyclic", async () => {
  await expect(generate({
    entry: "import 'a';",
    a: "import { b } from 'b'; console.log(b);",
    b: "import { c } from 'c'; export const b = c + 1;",
    c: "export const c = 1;",
  }, { manualChunks: id => id === "b" ? "beta" : ["a", "c"].includes(id) ? "alpha" : undefined }))
    .rejects.toThrow(/Circular chunk imports:.*alpha.*beta.*alpha/);
});

it("allows a lazy import with a static backlink and external imports", async () => {
  const result = await generate({
    entry: "import 'external'; export const initial = 1; export const load = () => import('lazy');",
    lazy: "import { initial } from 'entry'; export const value = initial + 1;",
  });
  expect(result.output.filter(item => item.type === "chunk")).toHaveLength(2);
});

it("allows source cycles contained within one chunk", async () => {
  const result = await generate({
    entry: "export { read } from 'a';",
    a: "import { b } from 'b'; export function read() { return b(); } export const a = 1;",
    b: "import { a } from 'a'; export function b() { return a; }",
  });
  expect(result.output.filter(item => item.type === "chunk")).toHaveLength(1);
});
