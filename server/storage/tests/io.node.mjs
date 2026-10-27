import { test } from "node:test";
import { runStorageFixture } from "./fixture.mjs";

test("JSON reads preserve fallback identity, JSON values and write errors", t => runStorageFixture(t, `
const {readJsonFile,writeJsonFile}=await import('@changmen/storage/json_file_store.js');
const {ESPORT_DATA_DIR}=await import('@changmen/storage/paths.js');
const fallback={missing:true}; assert.equal(readJsonFile('missing',fallback),fallback);
fs.writeFileSync(path.join(ESPORT_DATA_DIR,'broken.json'),'{'); assert.equal(readJsonFile('broken',fallback),fallback);
for(const value of [null,false,0,'value',[1],{nested:{ok:true}}]){
 writeJsonFile('value.JSON',value); assert.deepEqual(readJsonFile('value',fallback),value);
 assert.equal(fs.readFileSync(path.join(ESPORT_DATA_DIR,'value.json'),'utf8'),JSON.stringify(value,null,2));
}
fs.mkdirSync(path.join(ESPORT_DATA_DIR,'directory.json'));
assert.equal(readJsonFile('directory',fallback),fallback);
assert.throws(()=>writeJsonFile('directory',{}));
assert.throws(()=>writeJsonFile('undefined',undefined));
assert.throws(()=>writeJsonFile('bigint',1n));
`));

test("debounce keeps the first deadline, latest value and independent file timers", t => runStorageFixture(t, `
const {mock}=await import('node:test'); mock.timers.enable({apis:['setTimeout']});
const {readJsonFile,writeJsonFileDebounced}=await import('@changmen/storage/json_file_store.js');
writeJsonFileDebounced('one',{v:1},1000); mock.timers.tick(500);
writeJsonFileDebounced('one',{v:2},10000); writeJsonFileDebounced('two',{v:3},1000);
mock.timers.tick(499); assert.equal(readJsonFile('one',null),null);
mock.timers.tick(1); assert.deepEqual(readJsonFile('one',null),{v:2}); assert.equal(readJsonFile('two',null),null);
mock.timers.tick(500); assert.deepEqual(readJsonFile('two',null),{v:3});
writeJsonFileDebounced('one',{v:4},100); mock.timers.tick(100); assert.deepEqual(readJsonFile('one',null),{v:4});
writeJsonFileDebounced('skip',undefined,100); mock.timers.tick(100); assert.equal(readJsonFile('skip',null),null);
mock.timers.reset();
`));

test("flush writes immediately and cancels the old timer without touching other files", t => runStorageFixture(t, `
const {mock}=await import('node:test'); mock.timers.enable({apis:['setTimeout']});
const {readJsonFile,writeJsonFile,writeJsonFileDebounced,flushJsonFileDebounced}=await import('@changmen/storage/json_file_store.js');
writeJsonFileDebounced('one',{v:1},1000); writeJsonFileDebounced('two',{v:2},1000);
flushJsonFileDebounced('one'); assert.deepEqual(readJsonFile('one',null),{v:1});
assert.equal(readJsonFile('two',null),null); writeJsonFile('one',{manual:true});
flushJsonFileDebounced('one'); mock.timers.tick(1000);
assert.deepEqual(readJsonFile('one',null),{manual:true}); assert.deepEqual(readJsonFile('two',null),{v:2});
flushJsonFileDebounced('missing'); writeJsonFileDebounced('skip',undefined,1000); flushJsonFileDebounced('skip');
mock.timers.tick(1000); assert.equal(readJsonFile('skip',null),null); mock.timers.reset();
`));

test("pending debounced writes do not hold a native Node process open", t => runStorageFixture(t, `
const {writeJsonFileDebounced}=await import('@changmen/storage/json_file_store.js');
writeJsonFileDebounced('pending',{value:1},600000);
`, { timeout: 5000 }));

test("seed initialization and platform updates preserve existing fields/files", t => runStorageFixture(t, `
const {ensureStorageSeed,getPlatform,setPlatform,readJsonFile,writeJsonFile}=await import('@changmen/storage');
ensureStorageSeed(); assert.deepEqual(readJsonFile('platforms',null),{OB:{token:'example'}});
assert.deepEqual(readJsonFile('default_odds',null),{});
writeJsonFile('default_odds',{keep:true}); setPlatform('OB',{gateway:'fixture',provider:'spoof',updatedAt:0});
const config=getPlatform('OB'); assert.equal(config.token,'example'); assert.equal(config.gateway,'fixture');
assert.equal(config.provider,'OB'); assert(config.updatedAt>0); assert.equal(getPlatform('missing'),null);
ensureStorageSeed(); assert.deepEqual(readJsonFile('default_odds',null),{keep:true}); assert.deepEqual(getPlatform('OB'),config);
`, { files: { 'server/backend/platforms.example.json': '{"OB":{"token":"example"}}' } }));

test("seed falls back to empty platform data when no example exists", t => runStorageFixture(t, `
const {ensureStorageSeed,readJsonFile}=await import('@changmen/storage');
ensureStorageSeed(); assert.deepEqual(readJsonFile('platforms',null),{});
`));

test("all three market indexes retain their existing permissive disk-read behavior", t => runStorageFixture(t, `
const {writeJsonFile}=await import('@changmen/storage/json_file_store.js');
for(const [file,reader,writer] of [
 ['polymarket_market_index','readPolymarketMarketIndex','writePolymarketMarketIndex'],
 ['predictfun_market_index','readPredictFunMarketIndex','writePredictFunMarketIndex'],
 ['sxbet_market_index','readSxBetMarketIndex','writeSxBetMarketIndex']]){
 const api=await import('@changmen/storage/'+file+'.js'); assert.equal(api[reader](),null);
 for(const value of [{entries:[]},[],{legacy:true}]){api[writer](value);assert.deepEqual(api[reader](),value);}
 for(const value of [null,0,'invalid']){writeJsonFile(file,value);assert.equal(api[reader](),null);}
}
`));
