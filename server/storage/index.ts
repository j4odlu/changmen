/**
 * @changmen/storage — 本地 JSON 与 monorepo 路径（非 PostgreSQL）。
 */
export {
  CHANGMEN_ROOT,
  BACKEND_ROOT,
  STORAGE_DIR,
  ESPORT_DATA_DIR,
  ensureStoragePaths,
  findChangmenRoot,
} from "@changmen/storage/paths";

export { CHANGMEN_ROOT_FROM_PKG } from "@changmen/storage/changmen_root";

export {
  readJsonFile,
  writeJsonFile,
  writeJsonFileDebounced,
  flushJsonFileDebounced,
} from "@changmen/storage/json_file_store";

export {
  ensureDefaultJsonFiles,
  ensureStorageSeed,
  getPlatform,
  setPlatform,
} from "@changmen/storage/platform_storage";

export { loadChangmenEnv } from "@changmen/storage/load_env";
