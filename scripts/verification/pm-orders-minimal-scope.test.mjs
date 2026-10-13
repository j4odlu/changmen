import fs from "node:fs";
import { describe,it,expect } from "vitest";
import { verifyGitScope } from "./orders-phase2-git-scope.mjs";
const metadataPath="scripts/verification/pm-orders-minimal-scope.json";
function fixture(after=false){const text=fs.readFileSync(metadataPath,"utf8"),scope=JSON.parse(text),paths=[...Object.keys(scope.allowedFiles),metadataPath],head=after?"c".repeat(40):scope.base;
 const content=Object.fromEntries(paths.map(p=>[p,fs.readFileSync(p,"utf8")]));const state={head,work:[...paths],index:after?[...paths]:[],committed:after?[...paths]:[],untracked:[],content:{...content},indexContent:{...content},headContent:{...content}};
 const git={head:()=>state.head,assertAncestor:()=>{},workingPaths:()=>state.work,indexPaths:()=>state.index,committedPaths:()=>state.committed,untrackedPaths:()=>state.untracked,readBlobs:ref=>ref===":"?state.indexContent:state.headContent};
 return {state,scope,run:()=>verifyGitScope({scope,scopeText:text,fixedBase:"313c19e8afc30d62b54363830974b6738eab84d8",metadataPath,git,readFile:p=>state.content[p]})};}
describe("actual minimal candidate before/after commit simulation",()=>{
 it.each([false,true])("accepts same immutable package after=%s without writing Git",after=>expect(fixture(after).run().performedCommit).toBe(false));
 it.each([false,true])("rejects working content drift after=%s",after=>{const f=fixture(after);f.state.content["server/db/rds/pm_orders_minimal.js"]+="\nchanged";expect(f.run).toThrow();});
 it("rejects index content drift",()=>{const f=fixture(true);f.state.indexContent["server/db/rds/pm_orders_minimal.js"]+="\nchanged";expect(f.run).toThrow();});
 it("rejects HEAD content drift",()=>{const f=fixture(true);f.state.headContent["server/db/rds/pm_orders_minimal.js"]+="\nchanged";expect(f.run).toThrow();});
 it("rejects extra GTC refactoring path",()=>{const f=fixture();f.state.work.push("client/web/src/orderModes/gtc/execute.ts");expect(f.run).toThrow();});
 it("rejects tracked output paths",()=>{const f=fixture();f.state.work.push("output/hide.js");expect(f.run).toThrow();});
 it("rejects replacing the fixed application base",()=>{const f=fixture();f.scope.base="d".repeat(40);expect(f.run).toThrow();});
});
