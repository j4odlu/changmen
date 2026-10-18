import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { expect, test } from "vitest";
import type { ShadowWorkerRequest, ShadowWorkerResponse } from "../../submission/preflight/optimized/wsBook/shadowWorkerProtocol";

test("real isolated production Worker consumes shared frames, compares HTTP and resets on disconnect with no WS constructor", async () => {
  const entry = fileURLToPath(new URL("../../marketData.worker.ts", import.meta.url));
  const core = await build({ absWorkingDir: fileURLToPath(new URL("../../../../../", import.meta.url)),
    entryPoints: [fileURLToPath(new URL("../../../../../client/packages/pm-market-data-browser/src/bookStore.ts", import.meta.url))],
    bundle: true, write: false, platform: "browser", metafile: true });
  expect(Object.keys(core.metafile!.inputs).every(path => path.includes("client/packages/pm-market-data-browser/src/"))).toBe(true);
  const result = await build({ entryPoints: [entry], bundle: true, write: false, platform: "browser", format: "cjs", metafile: true });
  const dependencies = Object.keys(result.metafile!.inputs);
  expect(dependencies.some(path => path.includes("directBookFeed"))).toBe(false);
  expect(dependencies.some(path => /quotes\/marketQuoteHub|realtime\/ws\.ts/.test(path))).toBe(false);
  const worker = new Worker(`const {parentPort} = require('node:worker_threads');
    globalThis.WebSocket = class { constructor() { throw Error('passive worker must not open sockets'); } };
    globalThis.fetch = async () => { throw Error('offline test'); };
    globalThis.postMessage = data => parentPort.postMessage(data);
    ${result.outputFiles[0]!.text}
    parentPort.on('message', data => globalThis.onmessage({data}));`, { eval: true });
  const inbox: ShadowWorkerResponse[] = [];
  const serviceInbox: any[] = [];
  let error: Error | undefined;
  worker.on("message", data => {
    serviceInbox.push(data);
    if (data.type === "consumer") inbox.push(data.payload);
    if (data.type === "batch_ack") inbox.push({ type: "stream_ack", id: data.id });
  }); worker.on("error", e => { error = e; });
  let batch = 1000;
  worker.postMessage({ type: "batch", id: 0, requests: [{ type: "attach", scope: 1 }] });
  const send = (data: ShadowWorkerRequest) => worker.postMessage({ type: "batch", id: data.type === "stream" ? data.id : ++batch,
    requests: data.type === "stream" ? [data] : data.type === "assets" ? [data, { type: "consumer", scope: 1, payload: data }] : [{ type: "consumer", scope: 1, payload: data }] });
  const wait = async (predicate: (message: ShadowWorkerResponse) => boolean) => {
    const deadline = Date.now() + 5000;
    while (!inbox.some(predicate) && !error && Date.now() < deadline) await new Promise(done => setTimeout(done, 10));
    if (error) throw error;
    const value = inbox.find(predicate); expect(value).toBeDefined(); return value!;
  };
  try {
    send({ type: "assets", ids: ["1", "2"], generation: 1 });
    send({ type: "stream", id: 1, generation: 1, event: { type: "state", state: { epoch: 1, source: "official", open: true } } });
    await wait(m => m.type === "stream_ack" && m.id === 1);
    const timestamp = Date.now();
    const postFrame = (raw: unknown, sequence: number) => send({ type: "stream", id: sequence + 1, generation: 1,
      event: { type: "frame", epoch: 1, sequence, receivedAt: performance.timeOrigin + performance.now(), wallAt: Date.now(), raw: JSON.stringify(raw) } });
    postFrame({ event_type: "book", asset_id: "1", market: "m", timestamp: String(timestamp), hash: "h",
      bids: [{ price: "0.4", size: "3" }], asks: [{ price: "0.5", size: "20" }] }, 1);
    await wait(m => m.type === "stream_ack" && m.id === 2);
    postFrame({ event_type: "price_change", market: "m", timestamp: String(timestamp + 1),
      price_changes: [{ asset_id: "1", side: "SELL", price: "0.5", size: "7" }] }, 2);
    await wait(m => m.type === "stream_ack" && m.id === 3);
    const attempt = { tokenId: "1", gateway: "https://clob.polymarket.com", tick: false, proxied: false, role: "execute", leg: "1" };
    const metadataClockAt = performance.timeOrigin + performance.now();
    for (let id = 1; id <= 32; id++) send({ type: "begin", id, attempt, sentAt: performance.timeOrigin + performance.now() });
    for (let id = 1; id <= 32; id++) send({ type: "finish", id, failed: false, sentAt: performance.timeOrigin + performance.now(),
      raw: { price: .5, metadataClockAt, orderOptions: { version: 3, tickSize: "0.01", minOrderSize: 1, negRisk: false,
        bookTimestamp: timestamp + 1, asks: [{ price: .5, size: 7 }] } } });
    await wait(m => m.type === "sample" && m.id === 32);
    expect(inbox.filter(m => m.type === "sample" && m.sample.outcome === "aligned_equal")).toHaveLength(32);
    const ready = await wait(m => m.type === "metadata" && m.entries.length === 1);
    if (ready.type !== "metadata") throw Error("metadata");
    expect(ready.entries[0]).toMatchObject({ asset: "1", clockAt: metadataClockAt, version: 3 });
    expect(ready.entries[0]!.assetGeneration).toBeGreaterThan(0);
    const diagnostic = await wait(m => m.type === "report" && m.report.metadataInMemory === 1);
    if (diagnostic.type !== "report") throw Error("report");
    expect("executionMetadata" in diagnostic.report).toBe(false);
    postFrame({ event_type: "book", asset_id: "2", market: "m", timestamp: String(timestamp), hash: "h2",
      bids: [], asks: [{ price: "0.5", size: "7" }] }, 3);
    await wait(m => m.type === "stream_ack" && m.id === 4);
    send({type:"begin", id:33, attempt:{...attempt,tokenId:"2"}, sentAt:performance.timeOrigin + performance.now()});
    send({type:"finish", id:33, failed:false, sentAt:performance.timeOrigin + performance.now(), raw:{price:.5,
      metadataClockAt:performance.timeOrigin + performance.now(), orderOptions:{version:3,tickSize:"0.01",minOrderSize:1,
      negRisk:false,bookTimestamp:timestamp,asks:[{price:.5,size:7}]}}});
    const both = await wait(m => m.type === "metadata" && m.entries.length === 2);
    if (both.type !== "metadata") throw Error("both metadata");
    const retained = both.entries.find(row => row.asset === "2");
    postFrame({event_type:"tick_size_change",asset_id:"1",market:"m",timestamp:String(Date.now()),old_tick_size:"0.01",new_tick_size:"0.001"},4);
    const scoped = await wait(m => m.type === "metadata" && m.revision > both.revision && m.entries.length === 1);
    if (scoped.type !== "metadata") throw Error("scoped metadata");
    expect(scoped.entries).toEqual([retained]);
    expect(serviceInbox.some(m => m.type === "book_invalidated" && JSON.stringify(m.assets) === '["1"]')).toBe(true);
    worker.postMessage({type:"batch",id:50,requests:[
      {type:"full_book",id:51,asset:"1",generation:1,deadline:performance.timeOrigin+performance.now()+1000},
      {type:"full_book",id:52,asset:"2",generation:1,deadline:performance.timeOrigin+performance.now()+1000}]});
    await wait(m => m.type === "stream_ack" && m.id === 50);
    expect(serviceInbox.find(m=>m.type === "full_book" && m.id === 51).view.status).toBe("waiting_snapshot");
    expect(serviceInbox.find(m=>m.type === "full_book" && m.id === 52).view).toMatchObject({status:"ready",assetGeneration:retained!.assetGeneration,asks:[{price:"0.5",size:"7"}]});
    send({ type: "stream", id: 20, generation: 2, event: { type: "state", state: { epoch: 1, source: "official", open: false } } });
    const report = await wait(m => m.type === "report" && m.generation === 2);
    if (report.type !== "report") throw Error("test");
    expect(report.report).toMatchObject({ snapshotsInMemory: 0, activeSupported: false, executionSource: "existing-http", pendingAttempts: 0 });
  } finally { await worker.terminate(); }
}, 15_000);

test('real Worker batches preserve the snapshot/begin/delta/HTTP ordering and ACK only after the batch', async () => {
  const entry = fileURLToPath(new URL('../../marketData.worker.ts', import.meta.url));
  const built = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'browser', format: 'cjs' });
  const worker = new Worker(`const {parentPort} = require('node:worker_threads');
    globalThis.fetch = async () => { throw Error('offline'); };
    globalThis.WebSocket = class { constructor() { throw Error('no socket authority'); } };
    globalThis.postMessage = data => parentPort.postMessage(data);
    ${built.outputFiles[0]!.text}
    parentPort.on('message', data => globalThis.onmessage({data}));`, { eval: true });
  const inbox: ShadowWorkerResponse[] = [];
  const done = new Promise<void>((resolve, reject) => {
    worker.on('error', reject); worker.on('message', (data: any) => {
      if (data.type === 'consumer') inbox.push(data.payload); else inbox.push(data); if (data.type === 'batch_ack') resolve();
    });
  });
  const at = Date.now(), sentAt = performance.timeOrigin + performance.now();
  const frame = (raw: unknown, sequence: number): ShadowWorkerRequest => ({ type: 'stream', id: sequence + 1, generation: 1,
    event: { type: 'frame', epoch: 1, sequence, receivedAt: sentAt, wallAt: at, raw: JSON.stringify(raw) } });
  const requests: ShadowWorkerRequest[] = [
    { type: 'assets', ids: ['1'], generation: 1 },
    { type: 'stream', id: 1, generation: 1, event: { type: 'state', state: { epoch: 1, source: 'official', open: true } } },
    frame({ event_type: 'book', asset_id: '1', market: 'm', timestamp: String(at), hash: 'h', bids: [], asks: [{ price: '0.5', size: '20' }] }, 1),
    { type: 'begin', id: 1, sentAt, attempt: { tokenId: '1', gateway: 'https://clob.polymarket.com', tick: false, proxied: false, role: 'execute', leg: '1' } },
    frame({ event_type: 'price_change', market: 'm', timestamp: String(at + 1), price_changes: [{ asset_id: '1', side: 'SELL', price: '0.5', size: '7' }] }, 2),
    { type: 'finish', id: 1, sentAt, failed: false, raw: { price: .5, orderOptions: { bookTimestamp: at + 1, asks: [{ price: .5, size: 7 }] } } },
  ];
  try {
    worker.postMessage({ type: 'batch', id: 99, requests: [{ type: 'attach', scope: 1 }, ...requests.flatMap(data => data.type === 'stream' ? [data] : data.type === 'assets' ? [data, { type: 'consumer', scope: 1, payload: data }] : [{ type: 'consumer', scope: 1, payload: data }])] }); await done;
    expect(inbox.filter(x => x.type === 'stream_ack')).toHaveLength(0);
    const sample = inbox.find(x => x.type === 'sample');
    expect(sample).toMatchObject({ type: 'sample', sample: { outcome: 'aligned_equal', revision: 1, depthAtHttpFillPrice: 10 } });
    expect(inbox.at(-1)).toEqual({ type: 'batch_ack', id: 99 });
  } finally { await worker.terminate(); }
}, 10_000);


test('production Worker keeps public depth across diagnostic attach/detach and has no HTTP without a consumer', async () => {
  const built = await build({ entryPoints: [fileURLToPath(new URL('../../marketData.worker.ts', import.meta.url))], bundle: true, write: false, platform: 'browser', format: 'cjs' });
  const worker = new Worker(`const {parentPort} = require('node:worker_threads');
    globalThis.fetch = async () => { parentPort.postMessage({type:'fetch-observed'}); throw Error('offline'); };
    globalThis.WebSocket = class { constructor() { throw Error('no socket'); } };
    globalThis.postMessage = data => parentPort.postMessage(data);
    ${built.outputFiles[0]!.text}
    parentPort.on('message', data => globalThis.onmessage({data}));`, { eval: true });
  const inbox: any[] = []; let serial = 0;
  worker.on('message', data => inbox.push(data));
  const send = (requests: unknown[]) => worker.postMessage({type:'batch', id: ++serial, requests});
  const wait = async (predicate: (message: any) => boolean) => {
    const until = Date.now() + 5000;
    while (!inbox.some(predicate) && Date.now() < until) await new Promise(r => setTimeout(r, 10));
    const found = inbox.find(predicate); expect(found).toBeDefined(); return found;
  };
  const frame = (size: string, sequence: number) => ({type:'stream', generation:1, event:{type:'frame', epoch:1, sequence,
    receivedAt:performance.timeOrigin + performance.now(), wallAt:Date.now(), raw:JSON.stringify({event_type:'book', asset_id:'1', market:'m',
      timestamp:String(Date.now()), hash:'h', bids:[], asks:[{price:'0.5', size}]})}});
  try {
    send([{type:'assets', ids:['1'], generation:1}, {type:'stream', generation:1,event:{type:'state', state:{epoch:1,open:true,source:'official'}}}, frame('7',1)]);
    await new Promise(r => setTimeout(r, 3100)); expect(inbox.some(x => x.type === 'fetch-observed')).toBe(false);
    send([{type:'attach',scope:10},{type:'consumer',scope:10,payload:{type:'assets',ids:['1'],generation:1}}]);
    await wait(x => x.type === 'fetch-observed');
    send([{type:'detach',scope:10}, frame('9',2), {type:'depth',id:90,asset:'1',levels:20,generation:1}]);
    expect((await wait(x => x.type === 'depth' && x.id === 90)).view).toMatchObject({revision:2,asks:[{price:'0.5',size:'9'}]});
    const fetches = inbox.filter(x => x.type === 'fetch-observed').length;
    await new Promise(r => setTimeout(r, 3100)); expect(inbox.filter(x => x.type === 'fetch-observed')).toHaveLength(fetches);
    send([{type:'attach',scope:11},{type:'consumer',scope:10,payload:{type:'assets',ids:[],generation:1}}, {type:'depth',id:91,asset:'1',levels:20,generation:1}]);
    expect((await wait(x => x.type === 'depth' && x.id === 91)).view).toMatchObject({revision:2,asks:[{price:'0.5',size:'9'}]});
  } finally { await worker.terminate(); }
}, 15000);
