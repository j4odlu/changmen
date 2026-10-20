// [changmen 扩展] Only canonical data-layer assets remain; never generates backend copies.
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const checksum=text=>createHash('sha256').update(text.replaceAll('\r\n','\n')).digest('hex');
export function inspectRdsAssets(root){
 root=fs.realpathSync(root);
 const safe=file=>{const target=fs.realpathSync(path.join(root,file)),relative=path.relative(root,target);
  if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('RDS asset path escapes workspace');return target;};
 const baselinePath='server/db/assets/schema-baseline.json',text=fs.readFileSync(safe(baselinePath),'utf8'),baseline=JSON.parse(text);
 const policy=JSON.parse(fs.readFileSync(safe('scripts/verification/retained-source-boundaries.json'),'utf8'));
 if(checksum(text)!==policy.groups.find(g=>g.id==='rds-assets')?.baselineSha256)throw Error('Canonical RDS baseline differs from the retained historical contract');
 const names=Object.keys(baseline.migrations);
 if(!names.length||names.some(name=>!/^\d+_[a-zA-Z0-9_]+\.sql$/.test(name)))throw Error('Invalid RDS asset manifest');
 const actual=fs.readdirSync(safe('server/db/assets/migrations')).filter(name=>/^\d+_.*\.sql$/.test(name)).sort();
 if(JSON.stringify(actual)!==JSON.stringify([...names].sort()))throw Error('Canonical RDS asset manifest does not cover every SQL file');
 for(const name of names)if(checksum(fs.readFileSync(safe('server/db/assets/migrations/'+name),'utf8'))!==baseline.migrations[name])throw Error('Canonical RDS migration checksum changed: '+name);
 const violations=[];
 for(const file of ['server/backend/db','server/backend/scripts/rds-schema-baseline.json'])if(fs.lstatSync(path.join(root,file),{throwIfNoEntry:false}))violations.push({rule:'rds-asset-retirement',file,line:0,spec:baselinePath,pattern:'Retired backend RDS assets must not return'});
 return {purpose:'canonical-rds-assets-only',publishScopeOptimizationEnabled:false,assets:names.length+1,violations};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.slice(2).some(arg=>arg!=='--check'))throw Error('Use --check (default); backend copy generation has been retired');
 const report=inspectRdsAssets(fileURLToPath(new URL('../../',import.meta.url)));console.log(JSON.stringify(report));if(report.violations.length)process.exitCode=1;
}
