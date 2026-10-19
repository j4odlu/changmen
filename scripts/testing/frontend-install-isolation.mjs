// [changmen 扩展] Offline browser install/build with explicit source inputs and no server tree.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readInstallWorkspaces,declaredInstallClosure} from '../verification/component-install-inputs.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const out=path.join(root,'output/frontend-install-isolation');
fs.mkdirSync(out,{recursive:true});
const closure=declaredInstallClosure(root,readInstallWorkspaces(root),'@changmen/web',{build:true});
assert.deepEqual(closure.violations,[]);
assert(!closure.sourceDirectories.some(dir=>dir.startsWith('server/')));
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'changmen-frontend-isolation-'));
const report={passed:false,productionWrites:false,lifecycleScriptsEnabled:false,fixture,closure,steps:[]};
const save=()=>fs.writeFileSync(path.join(out,'verdict.json'),JSON.stringify(report,null,2));
save();
const npm=[process.env.CHANGMEN_TEST_NPM_CLI,path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js')].find(file=>file&&fs.existsSync(file));
assert(npm,'Set CHANGMEN_TEST_NPM_CLI to the npm CLI JavaScript file');
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8',maxBuffer:30*1024*1024,windowsHide:true}).split('\0').filter(Boolean);
try{
 for(const file of files){
  if(!closure.sourceDirectories.some(dir=>file.startsWith(dir+'/'))&&!['package.json','package-lock.json'].includes(file))continue;
  if(/(?:^|\/)\.env(?:\.|$)|(?:^|\/)\.npmrc$|\.(?:pem|key|p12|pfx)$/i.test(file))continue;
  const source=path.join(root,file);if(!fs.existsSync(source)||!fs.statSync(source).isFile())continue;
  const target=path.join(fixture,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);
 }
 const pkg=JSON.parse(fs.readFileSync(path.join(fixture,'package.json')));
 pkg.workspaces=closure.workspaceDirectories;
 fs.writeFileSync(path.join(fixture,'package.json'),JSON.stringify(pkg,null,2));
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|COMSPEC)$/i.test(key)));
 const run=(name,args)=>{
  console.log('Running '+name);
  try{
   const output=execFileSync(process.execPath,[npm,...args],{cwd:fixture,env,encoding:'utf8',windowsHide:true,timeout:240000,maxBuffer:20*1024*1024});
   fs.writeFileSync(path.join(out,name+'.log'),output);report.steps.push({name,passed:true});
  }catch(error){fs.writeFileSync(path.join(out,name+'.log'),String(error.stdout??'')+String(error.stderr??''));report.steps.push({name,passed:false});throw error;}
  finally{save();}
 };
 run('install',['ci','--offline','--ignore-scripts','--no-audit','--no-fund']);
 run('build',['run','build','--workspace=@changmen/web']);
 assert(fs.readFileSync(path.join(fixture,'package-lock.json')).equals(fs.readFileSync(path.join(root,'package-lock.json'))));
 assert(!fs.existsSync(path.join(fixture,'server')));
 assert(!fs.existsSync(path.join(fixture,'packages/client-core')));
 assert(!fs.existsSync(path.join(fixture,'packages/arb-core')));
 for(const name of ['client-core','arb-core','pm-market-data-browser','venue-browser'])
  assert.equal(fs.realpathSync(path.join(fixture,'node_modules/@changmen',name)),fs.realpathSync(path.join(fixture,'client/packages',name)));
 assert(fs.existsSync(path.join(fixture,'client/packages/venue-browser/pm-book-source.ts')));
 assert(fs.existsSync(path.join(fixture,'client/packages/venue-browser/package.json')));
 Object.assign(report,{passed:true,serverAbsent:true,legacyClientPackageDirectoriesAbsent:true,packageLockUnchanged:true});
 save();console.log(JSON.stringify({passed:true,workspaces:closure.workspaceDirectories.length,sourceDirectories:closure.sourceDirectories.length,serverAbsent:true}));
}finally{
 assert.equal(path.dirname(path.resolve(fixture)),path.resolve(os.tmpdir()));
 assert(path.basename(fixture).startsWith('changmen-frontend-isolation-'));
 fs.rmSync(fixture,{recursive:true,force:true});report.fixtureRemoved=true;save();
}
