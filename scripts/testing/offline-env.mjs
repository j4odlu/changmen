import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Offline suites must never inherit a developer's database or storage destination.
process.env.DATABASE_URL = "postgresql://offline:offline@127.0.0.1:1/changmen_offline";
process.env.DATABASE_URL_PUBLIC = "";
process.env.DATABASE_URL_INTERNAL = "";
process.env.DATABASE_POOL_CONNECT_TIMEOUT_MS = "100";
const tempRoot = path.resolve(os.tmpdir());
const testStorage = mkdtempSync(path.join(tempRoot, "changmen-offline-"));
process.env.CHANGMEN_STORAGE_DIR = testStorage;
process.env.ESPORT_DATA_DIR = path.join(testStorage, "esport");
process.on("exit", () => {
  if (path.dirname(path.resolve(testStorage)) === tempRoot
    && path.basename(testStorage).startsWith("changmen-offline-")) {
    rmSync(testStorage, { recursive: true, force: true });
  }
});
