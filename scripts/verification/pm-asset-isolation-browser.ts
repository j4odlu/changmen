// [changmen 扩展] Browser fixture only: deterministic faults never enter the original PM-M.
import { PmOrderBookService } from '../../packages/venue-adapter/polymarket/realtime/orderBook/service';
import type { MarketStreamEvent } from '../../packages/venue-adapter/polymarket/realtime/marketStreamProtocol';
const workerUrl = (await (await fetch('/verification-worker.json')).json()).url;
const pause = (ms = 20) => new Promise(r => setTimeout(r, ms));
const output = document.querySelector('#status')!;
document.querySelector<HTMLButtonElement>('#run')!.onclick = async () => {
  const checks: Array<{ name: string; pass: boolean; details?: unknown }> = [];
  const check = (name: string, pass: boolean, details?: unknown) => { checks.push({ name, pass, details }); if (!pass) throw Error(name); };
  let forward!: (event: MarketStreamEvent) => void;
  let sequence = 0, epoch = 1, roster = ['1', '2'], workers = 0, terminated = 0;
  const messages: any[] = [], metadata: any[] = [];
  const owner = new PmOrderBookService(() => true, () => {
    workers++; const worker = new Worker(workerUrl, { type: 'module' });
    const terminate = worker.terminate.bind(worker); worker.terminate = () => { terminated++; terminate(); };
    worker.addEventListener('message', e => { if (e.data.type === 'book_invalidated') messages.push(e.data); });
    return worker;
  }, () => roster, fn => { forward = fn; fn({type:'state',state:{epoch,open:true,source:'official'}}); return () => {}; });
  const lease = owner.acquire(); lease.setInterests(roster);
  const diag = owner.attachDiagnostics(payload => { const p = payload as any; if (p.type === 'metadata') metadata.push(p); });
  diag.send({type:'assets',ids:roster,generation:owner.report().generation});
  const frame = (value: unknown) => { forward({type:'frame',epoch,sequence:++sequence,receivedAt:performance.timeOrigin+performance.now(),wallAt:Date.now(),raw:typeof value === 'string' ? value : JSON.stringify(value)}); };
  const snapshot = (asset: string, size = '20') => ({event_type:'book',asset_id:asset,market:'m',timestamp:String(Date.now()),hash:`h-${asset}-${sequence}`,bids:[{price:'0.4',size:'10'}],asks:[{price:'0.5',size}]});
  const full = async () => [await lease.readFullBook('1'), await lease.readFullBook('2')];
  let id = 0;
  const seedMetadata = async (asset: string) => {
    const view = await lease.readFullBook(asset), at = performance.timeOrigin + performance.now(), request = ++id;
    diag.send({type:'begin',id:request,attempt:{tokenId:asset,gateway:'https://clob.polymarket.com',tick:false,proxied:false,role:'precheckOnly'},sentAt:at});
    diag.send({type:'finish',id:request,failed:false,sentAt:at,raw:{price:.5,metadataClockAt:at,orderOptions:{version:3,tickSize:'0.01',minOrderSize:1,negRisk:false,bookTimestamp:view.sourceAt,asks:[{price:.5,size:20}]}}});
    await pause();
  };
  const captures: any[] = [];
  try {
    await pause(100); frame([snapshot('1'),snapshot('2')]); await pause();
    check('two books initialized', (await full()).every(v => v.status === 'ready'));
    await seedMetadata('1'); await seedMetadata('2');
    const metaB = metadata.at(-1)?.entries.find((r: any) => r.asset === '2');
    check('both metadata initialized', metadata.at(-1)?.entries.length === 2);
    for (const fault of ['tick', 'bad-depth', 'missing-timestamp'] as const) {
      const before = await full();
      if (fault === 'tick') frame({event_type:'tick_size_change',asset_id:'1',market:'m',old_tick_size:'0.01',new_tick_size:'0.001',timestamp:String(Date.now())});
      else if (fault === 'bad-depth') frame({...snapshot('1'),asks:[{price:'invalid',size:'20'}]});
      else { const {timestamp, ...missing} = snapshot('1'); frame(missing); }
      await pause(); const after = await full();
      check(`${fault}: target revoked, peer preserved`, after[0]!.status === 'waiting_snapshot' && after[1]!.status === 'ready'
        && after[1]!.assetGeneration === before[1]!.assetGeneration && after[1]!.sourceAt === before[1]!.sourceAt, after);
      check(`${fault}: peer metadata original age preserved`, JSON.stringify(metadata.at(-1)?.entries) === JSON.stringify([metaB]));
      frame({event_type:'price_change',market:'m',timestamp:String(Date.now()),price_changes:[{asset_id:'1',side:'SELL',price:'0.5',size:'10'}]}); await pause();
      check(`${fault}: delta cannot revive target`, (await lease.readFullBook('1')).status === 'waiting_snapshot');
      frame(snapshot('1')); await pause(); const recovered = await lease.readFullBook('1');
      check(`${fault}: fresh snapshot new asset generation`, recovered.status === 'ready' && recovered.assetGeneration !== before[0]!.assetGeneration);
      captures.push({fault,before,after,recovered}); await seedMetadata('1');
    }
    frame({event_type:'price_change',market:'m',timestamp:String(Date.now()),price_changes:[{asset_id:'1',side:'SELL',price:'0.5',size:'9'},{asset_id:'2',side:'SELL',price:'broken',size:'8'}]});
    await pause(); check('mixed bad frame revokes all involved assets', (await full()).every(v => v.status === 'waiting_snapshot'));
    frame([snapshot('1'),snapshot('2')]); await pause();
    const prior = await full(); roster = ['2']; owner.reconcile(); await pause();
    check('removing target preserves healthy peer', (await lease.readFullBook('2')).assetGeneration === prior[1]!.assetGeneration);
    roster = ['1','2']; owner.reconcile(); await pause();
    check('readding target cannot revive old book', (await lease.readFullBook('1')).status === 'waiting_snapshot');
    frame(snapshot('1')); await pause();
    check('readded target gets new generation', (await lease.readFullBook('1')).assetGeneration !== prior[0]!.assetGeneration);
    frame('{'); await pause(); check('unscoped bad frame fails globally', (await full()).every(v => v.status === 'waiting_snapshot'));
    frame([snapshot('1'),snapshot('2')]); await pause();
    forward({type:'state',state:{epoch,open:false,source:'official'}}); await pause();
    check('disconnect revokes all books', (await full()).every(v => v.status !== 'ready'));
    epoch++; sequence=0; forward({type:'state',state:{epoch,open:true,source:'official'}}); await pause();
    check('reconnect waits for snapshots', (await full()).every(v => v.status === 'waiting_snapshot'));
    frame([snapshot('1'),snapshot('2')]); await pause(); check('reconnect fresh snapshots recover', (await full()).every(v => v.status === 'ready'));
    const beforeDetach = await lease.readFullBook('2'); diag.release();
    frame({event_type:'price_change',market:'m',timestamp:String(Date.now()),price_changes:[{asset_id:'2',side:'SELL',price:'0.5',size:'21'}]}); await pause();
    const afterDetach = await lease.readFullBook('2');
    check('diagnostic detach preserves owner and advancing depth', owner.report().worker && owner.report().diagnostics === 0
      && afterDetach.status === 'ready' && afterDetach.assetGeneration === beforeDetach.assetGeneration
      && afterDetach.revision! > beforeDetach.revision! && afterDetach.asks?.[0]?.size === '21');
  } catch (error) { checks.push({ name:'completed',pass:false,details:String(error) }); }
  finally {
    diag.release(); lease.release(); owner.stop();
    check('all owned resources released', workers === 1 && terminated === 1 && owner.report().pendingReads === 0 && owner.report().consumers === 0);
    const value = { at:new Date().toISOString(),workerUrl,browser:navigator.userAgent,scope:'synthetic asset faults in actual browser production Worker; no PM-M, accounts or orders',checks,captures,invalidations:messages,metadata,final:owner.report() };
    await fetch('/verification-evidence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'asset-isolation-controlled',value})}); output.textContent=JSON.stringify(value,null,2);
  }
};
