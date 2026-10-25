import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {expect,it} from 'vitest';
import {MATCHER_LIFECYCLE_INCREMENTS as evidence,restoreMatcherLifecycleSource,restoreMatcherLifecycleVerificationSource,verifyMatcherLifecycleSources} from './matcher-lifecycle-boundary.mjs';
import {inspectWorkspaceLayout} from './workspace-layout-relocation.mjs';
import {WORKSPACE_LAYOUT_RELOCATION as relocation,restoreWorkspaceLayoutSource,readPreviousWorkspaceFile} from './workspace-layout-history.mjs';
import {restorePmSportsTypeScriptSource} from './pm-sports-typescript-boundary.mjs';
const read=file=>fs.readFileSync(file,'utf8');
const normalize=source=>source.replaceAll('\r\n','\n');
it('restores the complete original matcher source and keeps the original relocation evidence',()=>{
 expect(verifyMatcherLifecycleSources(read)).toEqual({files:6,assets:4,wiring:2});
 for(const row of evidence.files){
  const original=normalize(execFileSync('git',['show',`${evidence.baseline}:${row.file}`],{encoding:'utf8',windowsHide:true}));
  expect(row.before).toBe(original);
  const historical=relocation.files.find(old=>old.canonical===row.file);
  if(historical) expect(historical.afterSha).toBe(row.beforeSha);
  for(const source of [read(row.file),normalize(read(row.file)).replaceAll('\n','\r\n')]){
   expect(restoreMatcherLifecycleSource(row.file,source,read)).toBe(original);
   expect(restoreWorkspaceLayoutSource(row.file,source)).toBe(historical?.before ?? original);
  }
  if(historical) expect(readPreviousWorkspaceFile(new URL('../../'+historical.file,import.meta.url),'utf8')).toBe(historical.before);
 }
});
it('only restores the registered verification calls and rejects extra changes to either reader',()=>{
 for(const row of evidence.wiring){
  const original=normalize(execFileSync('git',['show',`${evidence.baseline}:${row.file}`],{encoding:'utf8',windowsHide:true}));
  expect(row.before).toBe(original);
  expect(restoreMatcherLifecycleVerificationSource(row.file,read(row.file),read)).toBe(original);
  expect(restoreMatcherLifecycleVerificationSource(row.file,normalize(read(row.file)).replaceAll('\n','\r\n'),read)).toBe(original);
  const changed=read(row.file)+'\nvoid skipGuard();';
  expect(restoreMatcherLifecycleVerificationSource(row.file,changed,read)).toBe(changed);
  expect(()=>verifyMatcherLifecycleSources(file=>file===row.file?changed:read(file))).toThrow('unreviewed matcher verification wiring');
 }
});
it('does not hide additional source changes or touch unrelated files',()=>{
 for(const row of evidence.files){
  const changed=read(row.file)+'\nvoid unreviewed();';
  expect(restoreMatcherLifecycleSource(row.file,changed,read)).toBe(changed);
  expect(()=>verifyMatcherLifecycleSources(file=>file===row.file?changed:read(file))).toThrow('unreviewed matcher lifecycle change');
  expect(()=>inspectWorkspaceLayout(process.cwd(),{read:file=>file===row.file?changed:read(file)})).toThrow('unreviewed matcher lifecycle change');
 }
 expect(restoreMatcherLifecycleSource('unrelated.js','unchanged')).toBe('unchanged');
});
it('rejects changes to lifecycle ownership or PM status dependencies in both offline readers',()=>{
 for(const asset of evidence.assets){
  const mutated=file=>read(file)+(file===asset.file?'\nvoid unreviewed();':'');
  expect(()=>verifyMatcherLifecycleSources(mutated)).toThrow('matcher lifecycle implementation changed');
  const row=evidence.files[0];
  expect(()=>restoreMatcherLifecycleSource(row.file,read(row.file),mutated)).toThrow('matcher lifecycle implementation changed');
  expect(()=>inspectWorkspaceLayout(process.cwd(),{read:mutated})).toThrow('matcher lifecycle implementation changed');
 }
});
it('rejects changing the registered WS persistence hook while retaining the fixed sports baseline',()=>{
 const file='server/collectors/polymarket-sports/index.js';
 const typed=read(file.replace(/\.js$/,'.ts'));
 const changed=typed.replace('persistSourceEventStates([sourceMessage], "ws")','persistSourceEventStates([sourceMessage], "gamma")');
 expect(changed).not.toBe(typed);
 expect(()=>restorePmSportsTypeScriptSource(file,read(file),changed)).toThrow('complete runtime implementation');
});
