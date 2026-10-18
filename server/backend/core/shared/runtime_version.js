/** [changmen 扩展] 运行身份是模块加载时的快照；后续 Git 更新不能冒充进程重启。 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabaseSchemaObserver, createConfiguredDatabaseSchemaObserver } from "@changmen/db/runtime_schema.js";
import { captureRuntimeVersion, readSourceVersion } from "@changmen/storage/runtime_version.js";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
export const backendRuntimeVersion = captureRuntimeVersion(path.resolve(root), "backend");
export function createRuntimeVersionReader({ running, source, pool, now = Date.now, database = createDatabaseSchemaObserver({ pool, now }) }) {
  return async () => {
    let workspace = null;
    try { workspace = source(); } catch { /* identity failure never exposes paths or errors */ }
    return { backend: running, workspace, restartRequired: workspace?.sourceFingerprint && running.sourceFingerprint ? running.sourceFingerprint !== workspace.sourceFingerprint : null, database: await database() };
  };
}
export const readRuntimeVersion = createRuntimeVersionReader({
  running: backendRuntimeVersion, source: () => readSourceVersion(path.resolve(root), "backend"),
  database: createConfiguredDatabaseSchemaObserver(),
});
