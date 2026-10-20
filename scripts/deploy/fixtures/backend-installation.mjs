import { backendProcesses } from "../verify-backend-processes.mjs";
export function installationProof(identity) {
  return { passed: true, sourceStable: true, identity: structuredClone(identity), platform: "linux", node: "v24.15.0",
    lifecycleScriptsEnabled: true, nativeEsbuildExecuted: true, browserPackagesAbsent: true, productionWrites: false,
    databaseStopped: true, resolution: { parityPassed: true }, dynamicPaths: { passed: true, uncertified: 0 },
    steps: [{ name: "fixture", passed: true, exitCode: 0, errorCode: null }],
    runtime: { passed: true, networkNamespace: true, actualEntries: true, upstreamsMocked: true, allChildrenExited: true,
      externalInterfaceCount: 0, productionWrites: false,
      processes: Object.keys(backendProcesses).map(name => ({ name, ready: true, shutdown: { code: 0 } })),
      failures: ["port-conflict", "missing-database-config", "missing-node-loader"].map(name => ({ case: name, rejected: true })) } };
}
