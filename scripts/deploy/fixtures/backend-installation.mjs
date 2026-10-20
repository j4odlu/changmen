import { backendProcesses } from "../verify-backend-processes.mjs";
export function installationProof(identity) {
  return { passed: true, sourceStable: true, identity: structuredClone(identity), platform: "linux", node: "v24.15.0",
    lifecycleScriptsEnabled: true, nativeEsbuildExecuted: true, browserPackagesAbsent: true, productionWrites: false,
    databaseStopped: true, resolution: { parityPassed: true }, dynamicPaths: { passed: true, uncertified: 0 },
    archive: { profile: "backend-runtime-v1", sha256: "a".repeat(64), sourceFingerprint: "b".repeat(64),
      fingerprintParity: true, browserSourcesAbsent: true, files: 1, bytes: 1 },
    steps: [{ name: "fixture", passed: true, exitCode: 0, errorCode: null }],
    runtime: { passed: true, networkNamespace: true, actualEntries: true, upstreamsMocked: true, allChildrenExited: true,
      externalInterfaceCount: 0, productionWrites: false,
      processes: Object.keys(backendProcesses).map(name => ({ name, ready: true, shutdown: { code: 0 } })),
      failures: ["port-conflict", "missing-database-config", "missing-node-loader"].map(name => ({ case: name, rejected: true })) } };
}
