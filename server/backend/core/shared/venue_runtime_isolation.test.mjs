import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import ts from "typescript";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
it("imports backend routes with probe imports and all network calls forbidden", () => {
  const result = spawnSync(process.execPath, ["--import", "./scripts/testing/offline-env.mjs", "--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import {registerHooks} from 'node:module';
    const requests=[];
    globalThis.fetch=(...args)=>{ requests.push(args); throw Error('Unexpected network request'); };
    const hooks=registerHooks({resolve(specifier,context,next){
      if(specifier.includes('platform-probes') || context.parentURL?.includes('/platform-probes/')) throw Error('Probe package is unavailable');
      const result=next(specifier,context);
      if(result.url.includes('/platform-probes/')) throw Error('Probe source is unavailable');
      return result;
    }});
    const {requirePlatform}=await import('@changmen/venue-node');
    for(const id of ['OB','RAY','TF','PB']) assert.equal(typeof requirePlatform(id,'node','session.js'),'object');
    assert.throws(()=>requirePlatform('HG','node','session.js'), {code:'MODULE_NOT_FOUND'});
    requirePlatform('IA','node','collect_credentials.js');
    requirePlatform('OB','node','core.js');
    requirePlatform('TF','node','auth.js');
    requirePlatform('RAY','node','shared','match_stage.js');
    const routes=await import('./server/backend/http_routes.js');
    assert.equal(typeof routes.createHttpHandler,'function');
    assert.equal(requests.length,0);
    hooks.deregister();
    console.log('backend imports without probes or network');
  `], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 20000,
    env: { ...process.env, CHANGMEN_NODE_ROOT: "", GAMEBET_NODE_ROOT: "", CHANGMEN_ADAPTER_ROOT: "", GAMEBET_ADAPTER_ROOT: "",
      CHANGMEN_PLATFORM_PROBES_ROOT: path.join(root, "missing-optional-probes"), GAMEBET_PLATFORM_PROBES_ROOT: "" } });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr || result.stdout).toBe(0);
  expect(result.stdout).toContain("backend imports without probes or network");
});

it("keeps every optional probe CLI's literal module imports resolvable without running it", () => {
  const probeRoot=path.join(root,"server/platform-probes");
  let checked=0;
  function walk(dir) {
    for(const item of fs.readdirSync(dir,{withFileTypes:true})) {
      if(item.name==='node_modules'||item.isSymbolicLink())continue;
      const file=path.join(dir,item.name);
      if(item.isDirectory()){walk(file);continue;}
      if(!/\.[cm]?js$/.test(file))continue;
      const source=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true),require=createRequire(file);
      function visit(node) {
        const spec=ts.isImportDeclaration(node)||ts.isExportDeclaration(node)?node.moduleSpecifier
          :ts.isCallExpression(node)&&node.expression.getText(ast)==='require'?node.arguments[0]:undefined;
        if(spec&&ts.isStringLiteralLike(spec))expect(()=>require.resolve(spec.text),file+' -> '+spec.text).not.toThrow();
        ts.forEachChild(node,visit);
      }
      visit(ast);checked++;
    }
  }
  walk(probeRoot);
  expect(checked).toBeGreaterThan(30);
});

it("preserves the optional HTTP probe and HG CLI exports",async()=>{
  for(const [file,names] of [
    ["hg/session.js",["tryLoadSession","fetchBalance","ensureOddsTypeEurope","persistPlatform"]],
    ["ia/session.js",["tryLoadSession","fetchGameList"]],
    ["imt/session.js",["tryLoadSession","fetchAllLiveEvents"]],
    ["saba/session.js",["tryLoadSession","fetchEsportsPage"]],
    ["saba/core.js",["parseEsportsPage"]],
    ["stake/session.js",["tryLoadSession","fetchAllSports"]],
    ["pb/core.js",["parseEuroOddsPayload"]],
  ]) {
    const namespace=await import("@changmen/platform-probes/"+file);
    for(const name of names)expect(typeof namespace[name],file+" -> "+name).toBe("function");
  }
});
