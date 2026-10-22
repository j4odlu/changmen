import type { Plugin } from "vite";

/** Check emitted static imports; source cycles within one chunk and lazy imports are separate. */
export function acyclicChunks(): Plugin {
  return {
    name: "changmen-acyclic-chunks",
    apply: "build",
    enforce: "post",
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        const chunks = new Map(Object.values(bundle)
          .filter(output => output.type === "chunk")
          .map(chunk => [chunk.fileName, chunk]));
        const visited = new Set<string>();
        const active = new Set<string>();
        const path: string[] = [];
        const visit = (fileName: string): void => {
          if (active.has(fileName)) {
            const cycle = [...path.slice(path.indexOf(fileName)), fileName];
            this.error(`Circular chunk imports: ${cycle.join(" -> ")}. Adjust vite/venueChunks.ts module ownership.`);
          }
          const chunk = chunks.get(fileName);
          if (!chunk || visited.has(fileName)) return;
          active.add(fileName);
          path.push(fileName);
          for (const dependency of chunk.imports) visit(dependency);
          path.pop();
          active.delete(fileName);
          visited.add(fileName);
        };
        for (const fileName of chunks.keys()) visit(fileName);
      },
    },
  };
}
