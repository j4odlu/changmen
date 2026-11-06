import * as Vue from "vue";
import { compileScript, compileTemplate, parse } from "vue/compiler-sfc";

/** Vitest's Node transform supplies ssrRender; compile the real client template for lifecycle tests. */
export function installClientRender(component: unknown, source: string, filename: string): void {
  const { descriptor, errors } = parse(source, { filename });
  if (errors.length || !descriptor.template) throw Error(`Cannot parse ${filename}: ${errors}`);
  const { bindings } = compileScript(descriptor, { id: filename });
  const result = compileTemplate({ source: descriptor.template.content, filename, id: filename,
    compilerOptions: { bindingMetadata: bindings } });
  if (result.errors.length) throw Error(`Cannot compile ${filename}: ${result.errors}`);
  const code = result.code.replace(/import\s*\{([^}]+)\}\s*from\s*["']vue["'];?/g,
    (_all, imports: string) => `const {${imports.replace(/\bas\b/g, ":")}} = Vue;`)
    .replace("export function render", "return function render");
  (component as { render: Vue.RenderFunction }).render = new Function("Vue", code)(Vue) as Vue.RenderFunction;
}
