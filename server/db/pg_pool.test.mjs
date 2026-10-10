import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachClientErrorHandler } from "./pg_pool.js";
afterEach(() => vi.restoreAllMocks());
function client() {
  return Object.assign(new EventEmitter(), { host: "pgm-example.pg.rds.aliyuncs.com", processID: 42,
    connection: { stream: { localAddress: "198.18.0.0", localPort: 1111, remoteAddress: "47.57.210.112", remotePort: 5432 } } });
}
describe("RDS connection diagnostics", () => {
  it("records unexpected end with time, connection age and the original socket path even after socket cleanup", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {}), c = client();
    attachClientErrorHandler(c); c.connection.stream = {}; c.emit("end");
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.parse(warn.mock.calls[0][1])).toMatchObject({ code: "UNEXPECTED_END", backendPid: 42,
      path: { localPort: 1111, remoteAddress: "47.57.210.112", remotePort: 5432 } });
    expect(JSON.parse(warn.mock.calls[0][1]).connectionAgeMs).toBeGreaterThanOrEqual(0);
  });
  it.each(["client", "connection"])("does not report normal %s ending or connection-pool retirement as network failure", kind => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {}), c = client();
    attachClientErrorHandler(c); (kind === "client" ? c : c.connection)._ending = true; c.emit("end");
    expect(warn).not.toHaveBeenCalled();
  });
  it("attaches once and retains the transport error code without logging credentials", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {}), c = client();
    c.password = "never-log-this"; attachClientErrorHandler(c); attachClientErrorHandler(c);
    c.emit("error", Object.assign(new Error("connection reset"), { code: "ECONNRESET" })); c.emit("end");
    expect(warn).toHaveBeenCalledTimes(2); expect(JSON.parse(warn.mock.calls[1][1]).code).toBe("ECONNRESET");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(c.password);
  });
});
