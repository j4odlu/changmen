#!/usr/bin/env node
/**
 * 构建 Gamebet Chrome 扩展：可读 background + esbuild 打包 content。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import esbuild from "esbuild";
import { readPmWalletDevOrigins } from "./pm-wallet-build-config.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.dirname(root);
const distRoot = path.join(root, "dist");

function outPath(rel) {
  return path.join(distRoot, rel);
}

function ensureOutDir(rel) {
  fs.mkdirSync(path.dirname(outPath(rel)), { recursive: true });
}

function syncVersionJson() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  ensureOutDir("version.json");
  fs.writeFileSync(
    outPath("version.json"),
    `${JSON.stringify({ version: manifest.version }, null, 2)}\n`,
    "utf8",
  );
  console.log("wrote dist/version.json", manifest.version);
}

async function bundleSocketIo() {
  const entry = path.join(repoRoot, "node_modules/socket.io-client/build/esm/index.js");
  if (!fs.existsSync(entry)) {
    console.warn("skip socket.io bundle — install workspace deps first");
    return;
  }
  ensureOutDir("vendor/socket.io.bundle.js");
  await esbuild.build({
    entryPoints: [entry],
    outfile: outPath("vendor/socket.io.bundle.js"),
    bundle: true,
    format: "iife",
    globalName: "io",
    platform: "browser",
  });
  console.log("bundled dist/vendor/socket.io.bundle.js");
}

async function bundleContent() {
  ensureOutDir("content.js");
  await esbuild.build({
    entryPoints: [path.join(root, "src/content/index.js")],
    outfile: outPath("content.js"),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["chrome109"],
  });
  console.log("bundled dist/content.js");
}

async function bundlePbWsContent() {
  ensureOutDir("pb-ws-content.js");
  await esbuild.build({
    entryPoints: [path.join(root, "src/content/pb-bridge-entry.js")],
    outfile: outPath("pb-ws-content.js"),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["chrome109"],
  });
  console.log("bundled dist/pb-ws-content.js");
}

async function bundleBackground() {
  const devOrigins = readPmWalletDevOrigins(path.join(repoRoot, "client/web"));
  ensureOutDir("background.js");
  await esbuild.build({
    entryPoints: [path.join(root, "src/background/index.js")],
    define: { __CHANGMEN_PM_DEV_ORIGINS__: JSON.stringify(devOrigins) },
    outfile: outPath("background.js"),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["chrome109"],
  });
  console.log("bundled dist/background.js");
  console.log("PM wallet development origins:", devOrigins.join(", "));
}

async function bundleObSportWsPage() {
  ensureOutDir("ob-sport-ws-page.js");
  await esbuild.build({
    entryPoints: [path.join(root, "src/content/ob-sport-ws-page.js")],
    outfile: outPath("ob-sport-ws-page.js"),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["chrome109"],
  });
  console.log("bundled dist/ob-sport-ws-page.js");
}

async function bundlePodAlerts() {
  ensureOutDir("pod-alerts-page.js");
  await esbuild.build({
    entryPoints: [path.join(root, "src/content/pod-alerts-page.js")],
    outfile: outPath("pod-alerts-page.js"),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["chrome109"],
  });
  console.log("bundled dist/pod-alerts-page.js");
}

await bundleBackground();
await bundleSocketIo();
await bundleContent();
await bundlePbWsContent();
await bundleObSportWsPage();
await bundlePodAlerts();
syncVersionJson();
