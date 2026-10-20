import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import { historicalPackages, verifyHistoricalPackage } from "./historical-release-packages.mjs";
const report = { passed: true, packages: historicalPackages.map(spec => verifyHistoricalPackage(spec)), currentReleaseAccepted: false };
fs.mkdirSync("output", { recursive: true });
fs.writeFileSync("output/historical-release-packages.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
