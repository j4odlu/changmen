import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {expect,it} from 'vitest';
import {inspectWorkspaceLayout,assertWorkspaceMoveSemantics} from './workspace-layout-relocation.mjs';
import {WORKSPACE_LAYOUT_RELOCATION as record} from './workspace-layout-history.mjs';
it('binds component roots to versioned source rather than leftover local directories',()=>{
 const policy=JSON.parse(fs.readFileSync('scripts/deploy/component-inputs.json'));
 const sources=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8',maxBuffer:32*1024*1024,windowsHide:true})
  .split('\0').filter(file=>file&&fs.existsSync(file)&&fs.statSync(file).isFile());
 expect(policy.nodeRoots).toContain('rds');
 for(const root of [...policy.nodeRoots,...policy.nodeOnlyPaths,...policy.browserRoots,...policy.browserOnlyPaths]){
  const clean=root.replace(/\/$/,'');
  expect(sources.some(file=>file===clean||file.startsWith(clean+'/')),root+': no versioned source beneath configured root').toBe(true);
 }
});
it('has three visible source roots, 24 workspaces and exact executable relocation proofs',()=>{
 expect(inspectWorkspaceLayout(process.cwd())).toMatchObject({workspaces:24,rdsRoot:'rds',platformRoot:'server/venues',unchangedSqlAssets:45});
},30000);
it('allows architecture and matcher documentation maintenance without rewriting migration evidence',()=>{
 const docs=new Set(['docs/ARCHITECTURE.md','server/match/matcher/README.md']);
 expect(inspectWorkspaceLayout(process.cwd(),{
  read:file=>fs.readFileSync(file,'utf8')+(docs.has(file)?'\n日常方案说明更新，不改变文件归属。\n':''),
 })).toMatchObject({workspaces:24,unchangedSqlAssets:45});
},30000);
it('still requires documentation at the canonical path and rejects a retired documentation entry returning',()=>{
 expect(()=>inspectWorkspaceLayout(process.cwd(),{read:file=>{
  if(file==='docs/ARCHITECTURE.md')throw new Error('canonical documentation missing');
  return fs.readFileSync(file,'utf8');
 }})).toThrow('canonical documentation missing');
 expect(()=>inspectWorkspaceLayout(process.cwd(),{
  exists:file=>file==='server/db/README.md'||fs.existsSync(file),
 })).toThrow('server/db/README.md: old implementation returned');
});
it('does not extend documentation maintenance to source or workspace configuration',()=>{
 for(const file of ['rds/admin_maintenance.js','rds/package.json']){
  expect(()=>inspectWorkspaceLayout(process.cwd(),{
   read:current=>fs.readFileSync(current,'utf8')+(current===file?'\nchanged':'')
  })).toThrow(file+': unreviewed relocation');
 }
});
it('rejects a retired package returning and SQL changes at the new root',()=>{
 expect(()=>inspectWorkspaceLayout(process.cwd(),{exists:f=>f==='packages/venue-adapter/package.json'||fs.existsSync(f)})).toThrow(/retired entry returned/);
 const sql=record.files.find(r=>r.file.endsWith('.sql'));
 expect(()=>inspectWorkspaceLayout(process.cwd(),{read:f=>fs.readFileSync(f,'utf8')+(f===sql.canonical?'\nDROP TABLE users;':'')})).toThrow(/unreviewed relocation/);
});
it('rejects executable changes even if a current-file checksum were re-recorded',()=>{
 const row=record.files.find(r=>r.file==='server/db/maintenance/rds-migrations.mjs');
 expect(()=>assertWorkspaceMoveSemantics(row,fs.readFileSync(row.canonical,'utf8').replace('pg_advisory_lock','pg_advisory_unlock'))).toThrow(/exceeds import\/resource relocation/);
});
it('accepts Git CRLF checkouts while preserving executable relocation checks',()=>{
 const row=record.files.find(r=>r.file==='server/db/admin_maintenance.js');
 const source=fs.readFileSync(row.canonical,'utf8').replace(/\r?\n/g,'\r\n');
 expect(()=>assertWorkspaceMoveSemantics(row,source)).not.toThrow();
});
