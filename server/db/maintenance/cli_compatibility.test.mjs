// [changmen 扩展] Public maintenance exports are import-safe and use canonical implementations.
import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
for (const file of ["check-rds-schema", "apply-rds-schema", "apply-order-observation-schema"]) {
  it(`${file}: public and canonical exports have identical object/function identity`, () => {
    // These are native Node CLI modules; exercise native resolution rather than Vite transforms.
    const code = `import assert from 'node:assert/strict';
      const old=await import('@changmen/db/maintenance/${file}.mjs'),next=await import('./server/db/maintenance/${file}.mjs');
      assert.deepEqual(Object.keys(old),Object.keys(next));
      for(const name of Object.keys(old))assert.equal(old[name],next[name]);console.log('same-exports');`;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", code], { cwd: root, encoding: "utf8", windowsHide: true });
    expect(result.status, result.stderr).toBe(0); expect(result.stdout.trim()).toBe("same-exports");
  });
}
it("importing canonical CLI modules cannot prepare a database connection or environment", () => {
  const imports = ["check-rds-schema", "apply-rds-schema", "apply-order-observation-schema"]
    .map(name => `server/db/maintenance/${name}.mjs`);
  const code = `import {registerHooks} from 'node:module';
    registerHooks({resolve(spec,ctx,next){if(spec==='@changmen/db'||spec==='@changmen/db/pg.js')throw Error('unexpected DB initialization');return next(spec,ctx);}});
    for(const file of ${JSON.stringify(imports)})await import(new URL(file,${JSON.stringify(new URL("../../../", import.meta.url).href)}));
    console.log('import-only');`;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", code], { cwd: root, encoding: "utf8", windowsHide: true });
  expect(result.status, result.stderr).toBe(0); expect(result.stdout.trim()).toBe("import-only");
});
for (const name of ["check-rds-schema", "apply-rds-schema"]) it(`${name}: canonical command retains failure exit/message without a real connection`, () => {
  const prefix = `import {registerHooks} from 'node:module';
    registerHooks({resolve(spec,ctx,next){
      if(spec==='@changmen/db')return {url:'data:text/javascript,export const initDatabaseUrl=async()=>{};export const buildPgClientConfig=()=>({});',shortCircuit:true};
      if(spec==='@changmen/db/pg.js')return {url:'data:text/javascript,export default {Client:class{constructor(){throw Error("unexpected connection");}}};',shortCircuit:true};
      return next(spec,ctx);}});
    delete process.env.DATABASE_URL;`;
  for (const directory of ["server/db/maintenance"]) {
    const file = new URL(`${directory}/${name}.mjs`, new URL("../../../", import.meta.url));
    const code = `${prefix}process.argv[1]=${JSON.stringify(fileURLToPath(file))};await import(${JSON.stringify(file.href)});`;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", code], { cwd: root, encoding: "utf8", windowsHide: true });
    expect(result.status).toBe(1); expect(result.stderr).toContain("[rds] 失败: 缺少 DATABASE_URL");
    expect(result.stderr).not.toContain("unexpected connection");
  }
});
