/**
 * 首次启动时创建 storage/*.json（不覆盖已有文件）。
 */
import fs from "node:fs";
import path from "node:path";
import { BACKEND_ROOT, ESPORT_DATA_DIR } from "@changmen/storage/paths";
import { readJsonFile, writeJsonFile } from "@changmen/storage/json_file_store";

const EMPTY_OBJECTS = [
  "default_odds",
];

export function ensureDefaultJsonFiles() {
  if (!fs.existsSync(filePath("platforms"))) {
    const example = path.join(BACKEND_ROOT, "platforms.example.json");
    if (fs.existsSync(example)) {
      fs.mkdirSync(ESPORT_DATA_DIR, { recursive: true });
      fs.copyFileSync(example, filePath("platforms"));
    } else {
      writeJsonFile("platforms", {});
    }
  }
}

export function ensureStorageSeed() {
  ensureDefaultJsonFiles();
  for (const name of EMPTY_OBJECTS) {
    if (!fs.existsSync(filePath(name))) {
      writeJsonFile(name, {});
    }
  }
}

function filePath(name: string): string {
  return path.join(ESPORT_DATA_DIR, `${name}.json`);
}
