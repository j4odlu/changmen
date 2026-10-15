import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

/** Isolated local database, never reads application .env or an existing cluster. */
export async function withTemporaryPostgres(run) {
  const suffix = process.platform === "win32" ? ".exe" : "";
  function executable(name) {
    for (const directory of [process.env.CHANGMEN_TEST_PG_BIN, ...(process.env.PATH || "").split(path.delimiter)].filter(Boolean)) {
      const file = path.join(directory, name + suffix);
      if (existsSync(file)) return file;
    }
    throw new Error(`Local PostgreSQL ${name} required; set CHANGMEN_TEST_PG_BIN`);
  }
  const initdb = executable("initdb"), pgctl = executable("pg_ctl");
  const tempRoot = path.resolve(os.tmpdir());
  const temporary = mkdtempSync(path.join(tempRoot, "changmen-phase2-pg-"));
  const data = path.join(temporary, "data");
  let startAttempted = false;
  try {
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer(); server.on("error", reject);
      server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); });
    });
    execFileSync(initdb, ["-D", data, "-U", "changmen_test", "--auth=trust", "--no-locale", "--encoding=UTF8", "--no-sync"],
      { windowsHide: true, stdio: "pipe", timeout: 60000 });
    // Clients use loopback TCP. Linux packages may default to a socket directory
    // owned by postgres (/var/run/postgresql), which the CI runner cannot write.
    appendFileSync(path.join(data, "postgresql.conf"), "\nunix_socket_directories = ''\n");
    startAttempted = true;
    const logFile = path.join(temporary, "postgres.log");
    try {
      execFileSync(pgctl, ["-D", data, "-l", logFile, "-o", `-h 127.0.0.1 -p ${port}`, "-w", "start"],
        { windowsHide: true, stdio: "ignore", timeout: 60000 });
    } catch (error) {
      const detail = existsSync(logFile) ? readFileSync(logFile, "utf8").slice(-12000) : String(error.stderr || error.message);
      throw new Error(`Temporary PostgreSQL startup failed:\n${detail}`, { cause: error });
    }
    // Set all alternatives before loading application modules. dotenv cannot select RDS.
    process.env.DATABASE_URL = `postgresql://changmen_test@127.0.0.1:${port}/postgres`;
    process.env.DATABASE_URL_PUBLIC = ""; process.env.DATABASE_URL_INTERNAL = "";
    process.env.DATABASE_SSL = "0";
    process.env.CHANGMEN_STORAGE_DIR = path.join(temporary, "storage");
    process.env.ESPORT_DATA_DIR = path.join(temporary, "storage", "esport");
    process.env.DATABASE_APPLICATION_NAME = "changmen-phase2-local-test";
    await run({ port, temporary });
  }
  finally {
    if (startAttempted && existsSync(path.join(data, "postmaster.pid")))
      execFileSync(pgctl, ["-D", data, "-m", "immediate", "-w", "stop"], { windowsHide: true, stdio: "ignore", timeout: 30000 });
    if (path.dirname(path.resolve(temporary)) === tempRoot && path.basename(temporary).startsWith("changmen-phase2-pg-"))
      rmSync(temporary, { recursive: true, force: true });
  }
}
