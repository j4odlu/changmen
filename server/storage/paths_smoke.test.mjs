import fs from "node:fs";
import path from "node:path";
import {
  CHANGMEN_ROOT,
  CHANGMEN_LAYOUT,
  BACKEND_ROOT,
  ESPORT_DATA_DIR,
  VENUE_ADAPTER_ROOT,
  VENUE_ADAPTER_REL,
} from "@changmen/storage/paths";

const backendPkg = path.join(BACKEND_ROOT, "package.json");
if (!fs.existsSync(backendPkg)) {
  throw new Error(`BACKEND_ROOT missing package.json: ${BACKEND_ROOT}`);
}
const pkg = JSON.parse(fs.readFileSync(backendPkg, "utf8"));
if (pkg.name !== "@changmen/backend") {
  throw new Error(`BACKEND_ROOT not @changmen/backend: ${BACKEND_ROOT}`);
}
const parent = path.basename(path.dirname(BACKEND_ROOT));
if (path.basename(BACKEND_ROOT) !== "backend" || parent !== "server") {
  throw new Error(`BACKEND_ROOT layout unexpected: ${BACKEND_ROOT}`);
}
if (!fs.existsSync(ESPORT_DATA_DIR)) {
  throw new Error(`ESPORT_DATA_DIR missing: ${ESPORT_DATA_DIR}`);
}
const dbDir = path.join(CHANGMEN_ROOT, CHANGMEN_LAYOUT.serverDb);
const dbPkg = path.join(dbDir, "package.json");
if (CHANGMEN_LAYOUT.serverDb !== "rds" || !fs.existsSync(dbPkg)
  || JSON.parse(fs.readFileSync(dbPkg, "utf8")).name !== "@changmen/db") {
  throw new Error(`CHANGMEN_ROOT missing root RDS workspace: ${CHANGMEN_ROOT}`);
}
const manifest = path.join(VENUE_ADAPTER_ROOT, "registry", "manifest.json");
if (!fs.existsSync(manifest)) {
  throw new Error(`VENUE_ADAPTER_ROOT missing registry/manifest.json: ${VENUE_ADAPTER_ROOT}`);
}

console.log("paths smoke OK:", {
  CHANGMEN_ROOT,
  BACKEND_ROOT,
  ESPORT_DATA_DIR,
  VENUE_ADAPTER_REL,
  VENUE_ADAPTER_ROOT,
});
