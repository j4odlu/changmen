import {afterEach,expect,it} from 'vitest';
import * as oldDepth from '../../pmFokDepthBufferMode';
import * as hostDepth from '../../fok/pmFokDepthBufferMode';
import * as depth from "../../../../polymarket/pmFokDepthBufferMode";
import * as oldTicks from '../../pmTickState';
import * as hostTicks from '../../quotes/pmTickState';
import * as ticks from "../../../../polymarket/pmTickState";
const disposers:Array<()=>void>=[];
afterEach(()=>{for(const dispose of disposers.splice(0))dispose();depth.resetPmFokDepthBufferPrefsForTests();ticks.clearPmTickStateForTests();});
const frame=(at:number,tick='0.01')=>JSON.stringify({event_type:'tick_size_change',asset_id:'state-test',timestamp:at,new_tick_size:tick});
it('all state entry points expose exactly the same functions',()=>{
 expect(Object.keys(oldDepth).sort()).toEqual(Object.keys(depth).sort());
 expect(Object.keys(hostDepth).sort()).toEqual(Object.keys(depth).sort());
 for(const key of Object.keys(depth) as Array<keyof typeof depth>){expect(oldDepth[key]).toBe(depth[key]);expect(hostDepth[key]).toBe(depth[key]);}
 expect(Object.keys(oldTicks).sort()).toEqual(Object.keys(ticks).sort());
 expect(Object.keys(hostTicks).sort()).toEqual(Object.keys(ticks).sort());
 for(const key of Object.keys(ticks) as Array<keyof typeof ticks>){expect(oldTicks[key]).toBe(ticks[key]);expect(hostTicks[key]).toBe(ticks[key]);}
});
it('preferences written through any path are shared, copied on read and reset together',()=>{
 depth.resetPmFokDepthBufferPrefsForTests();
 expect(oldDepth.getPmFokDepthBufferPrefs()).toEqual({enabled:false,multiplier:1.5});
 oldDepth.setPmFokDepthBufferPrefs({enabled:true,multiplier:2.26});
 expect(depth.getPmFokDepthBufferPrefs()).toEqual({enabled:true,multiplier:2.3});
 expect(hostDepth.pmFokDepthBufferNeedUsdc(10)).toBe(23);
 depth.getPmFokDepthBufferPrefs().multiplier=9;
 expect(oldDepth.pmFokDepthReuseMultiplier()).toBe(2.3);
 depth.setPmFokDepthBufferPrefs({enabled:true,multiplier:20});
 expect(oldDepth.getPmFokDepthBufferPrefs()).toEqual({enabled:true,multiplier:1.5});
 hostDepth.resetPmFokDepthBufferPrefsForTests();
 expect(depth.pmFokDepthBufferNeedUsdc(10)).toBeNull();expect(depth.pmFokDepthReuseMultiplier()).toBe(1);
});
it('mixed-path tick updates preserve freshness, duplicate suppression and notifications',()=>{
 ticks.clearPmTickStateForTests();const changes:string[]=[];
 disposers.push(oldTicks.onPmTickChange((id,tick,at)=>changes.push(id+':'+tick+':'+at)));
 hostTicks.notePmTickFrame(frame(100));
 expect(ticks.currentPmTick('state-test',100)).toBe('0.01');expect(ticks.currentPmTick('state-test',101)).toBeUndefined();
 ticks.notePmTickFrame(frame(100));oldTicks.notePmTickFrame(frame(99,'0.001'));
 ticks.notePmTickFrame(frame(101,'0.05'));ticks.notePmTickFrame('malformed');
 expect(changes).toEqual(['state-test:0.01:100']);
 ticks.notePmTickFrame(frame(100,'0.001'));
 expect(oldTicks.currentPmTick('state-test')).toBe('0.001');
 expect(changes).toEqual(['state-test:0.01:100','state-test:0.001:100']);
 oldTicks.clearPmTickStateForTests();expect(ticks.currentPmTick('state-test')).toBeUndefined();
 expect(changes).toHaveLength(2);
 ticks.notePmTickFrame(frame(102));expect(changes).toHaveLength(3);
 disposers.pop()!();hostTicks.notePmTickFrame(frame(103,'0.001'));expect(changes).toHaveLength(3);
});
it('reconnect notifications and disposal cross old and canonical entry points',()=>{
 let reconnects=0,changes=0;
 disposers.push(oldTicks.onPmTickReconnect(()=>{throw Error('listener failed');}));
 disposers.push(ticks.onPmTickReconnect(()=>{reconnects++;}));
 disposers.push(oldTicks.onPmTickChange(()=>{throw Error('listener failed');}));
 disposers.push(ticks.onPmTickChange(()=>{changes++;}));
 hostTicks.notePmTickReconnect();oldTicks.notePmTickFrame(JSON.stringify({event_type:'changmen_tick_resync'}));
 expect(reconnects).toBe(2);
 hostTicks.notePmTickFrame(frame(200));expect(changes).toBe(1);
 for(const dispose of disposers.splice(0))dispose();
 ticks.notePmTickReconnect();oldTicks.notePmTickFrame(frame(201,'0.001'));
 expect(reconnects).toBe(2);expect(changes).toBe(1);
});
