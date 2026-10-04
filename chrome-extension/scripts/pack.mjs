#!/usr/bin/env node
/**
 * 构建并打包 Chrome 扩展为 zip，供朋友「加载已解压的扩展程序」安装。
 * 输出：changmen/dist/gamebet-chromeplug-v{version}.zip
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const plugRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const changmenRoot = path.dirname(plugRoot);
const distRoot = path.join(changmenRoot, "dist");

/**
 * 扩展运行时需要的文件（不含 node_modules / src / scripts）。
 * manifest content_scripts / service worker 引用的路径会自动补入，漏打会导致 Chrome 拒绝加载。
 */
const RUNTIME_FILES = [
  "manifest.json",
  "popup.html",
  "popup.js",
  "sidepanel.html",
  "ob-sport-ws-offscreen.html",
  "ob-sport-ws-offscreen.js",
  "dist/version.json",
  "extension-id.json",
  "安装更新说明.txt",
];
const RUNTIME_DIRS = ["assets"];
/** 源图，不进发行包 */
const ASSET_SKIP = new Set(["jiraiya-icon-source.png", "konoha-public.svg"]);

const EXTENSION_ID = "mogfpjihgoghabicofkbcmcidlcoofee";

function runBuild() {
  console.log("[pack] npm run build …");
  execSync("npm run build", { cwd: plugRoot, stdio: "inherit" });
}

function readManifest() {
  return JSON.parse(
    fs.readFileSync(path.join(plugRoot, "manifest.json"), "utf8"),
  );
}

function readVersion() {
  return readManifest().version;
}

/** 从 manifest 收集 Chrome 加载时必须存在的路径 */
function collectManifestPaths(manifest) {
  const files = new Set();
  if (manifest.background?.service_worker) files.add(manifest.background.service_worker);
  if (manifest.side_panel?.default_path) files.add(manifest.side_panel.default_path);
  if (manifest.action?.default_popup) files.add(manifest.action.default_popup);
  const defaultIcon = manifest.action?.default_icon;
  if (typeof defaultIcon === "string") files.add(defaultIcon);
  else if (defaultIcon) {
    for (const p of Object.values(defaultIcon)) files.add(p);
  }
  for (const p of Object.values(manifest.icons || {})) files.add(p);
  for (const cs of manifest.content_scripts || []) {
    for (const p of cs.js || []) files.add(p);
    for (const p of cs.css || []) files.add(p);
  }
  return files;
}

function copyRuntimeFile(rel, outDir) {
  const src = path.join(plugRoot, rel);
  if (!fs.existsSync(src)) {
    throw new Error(`缺少文件 ${rel}，无法打包`);
  }
  const dest = path.join(outDir, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function stage(version) {
  const folderName = `gamebet-chromeplug-v${version}`;
  const outDir = path.join(distRoot, folderName);

  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outDir, { recursive: true });

  for (const name of RUNTIME_FILES) {
    copyRuntimeFile(name, outDir);
  }
  for (const name of RUNTIME_DIRS) {
    const src = path.join(plugRoot, name);
    if (!fs.existsSync(src)) {
      throw new Error(`缺少目录 ${name}，请先 npm run build`);
    }
    fs.cpSync(src, path.join(outDir, name), {
      recursive: true,
      filter: (p) => !ASSET_SKIP.has(path.basename(p)),
    });
  }

  for (const rel of collectManifestPaths(readManifest())) {
    copyRuntimeFile(rel, outDir);
  }

  const missing = [];
  for (const rel of collectManifestPaths(readManifest())) {
    if (!fs.existsSync(path.join(outDir, rel))) missing.push(rel);
  }
  if (missing.length) {
    throw new Error(`打包失败：manifest 引用的文件未打入包：${missing.join(", ")}`);
  }

  return { outDir, folderName };
}

function zipDir(outDir, folderName) {
  fs.mkdirSync(distRoot, { recursive: true });
  const zipPath = path.join(distRoot, `${folderName}.zip`);
  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }

  if (process.platform === "win32") {
    const psOut = outDir.replace(/'/g, "''");
    const psZip = zipPath.replace(/'/g, "''");
    execSync(
      `powershell -NoProfile -Command "Compress-Archive -LiteralPath '${psOut}' -DestinationPath '${psZip}' -Force"`,
      { stdio: "inherit" },
    );
  } else {
    execSync(
      `cd "${distRoot}" && zip -rq "${zipPath}" "${folderName}"`,
      { stdio: "inherit" },
    );
  }

  return zipPath;
}

function main() {
  runBuild();
  const version = readVersion();
  const { outDir, folderName } = stage(version);
  const zipPath = zipDir(outDir, folderName);

  const publishDir = path.join(changmenRoot, "server", "backend", "public", "extensions");
  fs.mkdirSync(publishDir, { recursive: true });
  const publishZip = path.join(publishDir, `${version}.zip`);
  fs.copyFileSync(zipPath, publishZip);
  const releaseFile = path.join(publishDir, "release.json");
  fs.writeFileSync(releaseFile, `${JSON.stringify({ schemaVersion: 1, product: "changmen-chrome-extension", extensionId: EXTENSION_ID, version }, null, 2)}\n`, "utf8");
  // [changmen 扩展] ZIP 成功发布后再更新版本公告，避免提示用户下载不存在的包。
  const versionFile = path.join(changmenRoot, "server", "backend", "public", "version.json");
  fs.writeFileSync(versionFile, `${JSON.stringify({ version }, null, 2)}\n`, "utf8");
  console.log(`  发布: server/backend/public/extensions/${version}.zip`);
  console.log(`  专用版本公告: server/backend/public/extensions/release.json`);
  console.log(`  版本公告: server/backend/public/version.json (${version})`);

  console.log("");
  console.log("打包完成");
  console.log(`  zip:     ${zipPath}`);
  console.log(`  文件夹:  ${outDir}`);
  console.log(`  版本:    ${version}`);
  console.log(`  扩展 ID: ${EXTENSION_ID}`);
  console.log("");
  console.log("发给朋友后安装步骤：");
  console.log("  1. 解压 zip");
  console.log(`  2. chrome://extensions → 开发者模式 → 加载已解压 → 选 ${folderName}`);
  console.log("  3. 确认扩展 ID 与上面一致");
  console.log("  4. 浏览器打开你的 changmen 地址（如 http://你的服务器:3456/）");
}

main();
