// Synthetic process I/O for gate tests only; never used by a real validation entry.
import fs from "node:fs";
import path from "node:path";
import { FULL_AUDIT_PHASES, FULL_CHECK_COVERAGE, executionContext } from "../deploy/acceptance-contract.mjs";
import { validationIdentity, validationCommands } from "../verification/verify-change.mjs";

export function fullAcceptanceFixture(cwd, mutate = () => {}) {
  return (_node, args, options) => {
    if (!args.includes("scripts/verification/verify-fok-release.mjs")) return { status: 0 };
    const releasePlan = args.find(arg => arg.startsWith("--release-plan=")).split("=")[1];
    const commands = validationCommands({}, options.env.npm_execpath, releasePlan);
    const report = { passed: true, sourceStable: true, fullReleaseAccepted: true, evidenceConsistent: true,
      identity: validationIdentity(cwd), invocationId: options.env.CHANGMEN_ACCEPTANCE_INVOCATION, context: executionContext(options.env), releasePlan,
      immutableBaselines: ["219535c8", "75b1efac66625e5f2bc9884a965b244bfaf337ed"],
      captureId: "12345678-1234-1234-1234-123456789abc", frontendVersion: "a".repeat(40), backendVersion: "a".repeat(40),
      results: FULL_AUDIT_PHASES.map(phase => {
        const check = Object.keys(FULL_CHECK_COVERAGE).find(check => FULL_CHECK_COVERAGE[check] === phase), selected = commands[check];
        return { phase, passed: true, exitCode: 0, errorCode: null, signal: null,
          execution: selected ? { command: selected.command, cwd: selected.cwd ?? "." } : { command: ["fixture-only"], cwd: "." } };
      }) };
    mutate(report);
    fs.mkdirSync(path.join(cwd, "output"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "output/fok-release-verdict.json"), JSON.stringify(report));
    return { status: 0 };
  };
}
