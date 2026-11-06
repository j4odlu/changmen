import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listenerAuthReturn, listenerEnvironment, listenerRouter } from "../build/listenerCompatibility";
import { assertIsolatedPaths, contains, listenerRoot, outputDir, repoRoot } from "../build/paths.mjs";
import config from "../build/vite.live.config";
import production from "../build/vite.production.config";
import { liveAliases } from "../build/liveAliases";

describe("original-code compatibility at build boundaries", () => {
  it("builds a production graph with shared environment and retained root assets", () => {
    expect(production).toMatchObject({ base: "/", envDir: path.join(repoRoot, "client/web"),
      build: { assetsDir: "assets/listener", outDir: outputDir } });
    expect(production).not.toHaveProperty("define");
    expect(production.plugins?.flat().map(plugin => plugin && "name" in plugin ? plugin.name : ""))
      .not.toContain("listener-original-environment");
  });
  it("protects the active output and keeps it separate from the original distribution", () => {
    expect(outputDir).toBe(path.join(listenerRoot, "build/dist"));
    expect(config).toMatchObject({ build: { outDir: outputDir } });
    expect(() => assertIsolatedPaths()).not.toThrow();
    expect(contains(listenerRoot, outputDir)).toBe(true);
    expect(contains(listenerRoot, `${listenerRoot}-other`)).toBe(false);
    expect(contains(outputDir, path.join(repoRoot, "client/web/dist"))).toBe(false);
    expect(contains(listenerRoot, path.resolve(outputDir, "../../../web/dist"))).toBe(false);
  });
  it("reads the original VITE configuration without forcing authentication or gate overrides", () => {
    expect(config).toMatchObject({ envDir: path.join(repoRoot, "client/web"), envPrefix: "VITE_" });
    expect(config).not.toHaveProperty("define");
    expect(liveAliases.map(alias => String(alias.find))).not.toContain("/^@\\/lib\\/localGates$/");
  });
  it("keeps original dev flags only for the local development bundle", () => {
    const hook = listenerEnvironment().config;
    if (typeof hook !== "function") throw new Error("Missing config hook");
    expect(Reflect.apply(hook, {}, [{}, { command: "build", mode: "development" }])).toEqual({ define: {
      "import.meta.env.DEV": "true", "import.meta.env.PROD": "false",
    } });
    expect(Reflect.apply(hook, {}, [{}, { command: "build", mode: "production" }])).toBeUndefined();
  });
  it("transforms only original history construction, retaining all route and guard bytes", () => {
    const file = path.join(repoRoot, "client/web/src/router/index.ts");
    const source = fs.readFileSync(file, "utf8");
    const hook = listenerRouter().transform;
    if (typeof hook !== "function") throw new Error("Missing transform hook");
    const transformed = Reflect.apply(hook, { error: (message: string) => { throw new Error(message); } }, [source, file]);
    expect(transformed.code).toBe(source.replaceAll("createWebHistory", "createWebHashHistory")
      .replace('createWebHashHistory("/")', "createWebHashHistory(window.location.pathname)"));
    expect(fs.readFileSync(file, "utf8")).toBe(source);
    expect(Reflect.apply(hook, {}, [source, file + ".other"])).toBeUndefined();
    expect(() => Reflect.apply(hook, { error: (message: string) => { throw new Error(message); } }, ["changed", file])).toThrow("history contract changed");
  });
  it("reuses original application/session/gates and replaces only the scan and listener store entry", () => {
    const aliases = liveAliases.map(alias => String(alias.find));
    expect(aliases.filter(alias => /appSession|checkArbLegs|localGates|authSession/.test(alias))).toEqual([]);
    expect(aliases.filter(alias => /CollectConfigPanel/.test(alias))).toEqual([]);
    const main = fs.readFileSync(path.join(repoRoot, "client/listener/module/bootstrap.ts"), "utf8");
    expect(main).toContain('import "../../web/src/main"');
    expect(main).not.toMatch(/createApp|createPinia|installSessionRecovery/);
    const loop = fs.readFileSync(path.join(repoRoot, "client/listener/module/mainBetLoop.ts"), "utf8");
    expect(loop).toContain("originalTick(state)");
    expect(loop).not.toMatch(/Date\.now|fetchMatches|valueBet|processLoseOrders/);
    const module = fs.readFileSync(path.join(repoRoot, "client/listener/module/runtime.ts"), "utf8");
    expect(module).toContain("this.originalStart()");
    expect(module).not.toMatch(/lastLoseOrderPruneAt\s*=|defaultOddsFetchedAt\s*=|ensureTokenRefresh|startPmSportRealtimeFeed/);
  });
  it("adapts only the original authentication return expression, without copying its function", () => {
    const file = path.join(repoRoot, "client/web/src/lib/authSession.ts");
    const source = fs.readFileSync(file, "utf8");
    const hook = listenerAuthReturn().transform;
    if (typeof hook !== "function") throw new Error("Missing transform hook");
    const transformed = Reflect.apply(hook, { error: (message: string) => { throw new Error(message); } }, [source, file]);
    expect(transformed.code).toBe(source.replace('window.location.href = "/"', 'window.location.href = `${window.location.pathname}#/`'));
    expect(fs.readFileSync(file, "utf8")).toBe(source);
    expect(() => Reflect.apply(hook, { error: (message: string) => { throw new Error(message); } }, ["changed", file])).toThrow("authentication return contract changed");
  });
  it("keeps a versioned bootstrap for the optional standalone build", () => {
    const bootstrap = fs.readFileSync(path.join(repoRoot, "client/listener/build/localBootstrap.ts"), "utf8");
    expect(bootstrap).toContain("bootstrap-${path.posix.basename(entry.fileName)}");
  });
});
