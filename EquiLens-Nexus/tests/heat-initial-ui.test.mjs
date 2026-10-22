import test from 'node:test';
import assert from 'node:assert/strict';
const listeners=[],timers=[];
globalThis.document={hidden:false,addEventListener(type,fn){if(type==='click')listeners.push(fn);},getElementById(id){return id==='heatmap'?{}:null;},querySelector(){return null;}};
const interval=globalThis.setInterval;globalThis.setInterval=(fn,ms)=>{if(ms===10000)timers.push(fn);return 0;};
const RealDate=Date,at=RealDate.parse('2026-10-22T10:00:00+08:00');
globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[at]));}static now(){return at;}};
const ui=await import('../public/heatmap.js');globalThis.setInterval=interval;
const click=async()=>{for(const fn of listeners)await fn({target:{closest:()=>({dataset:{heat:'live'}})}});};
test.after(()=>globalThis.Date=RealDate);
test('live initialization keeps polling after initial history was cancelled; stale errors cannot replace it',async()=>{
 let rejectHistory,liveCalls=0;
 ui.initHeatmap({state:()=>({capabilities:{stream:'shioaji'},tokenConfigured:false,job:{running:false}}),redraw(){},toast(){},api:path=>{
  if(path==='heatmap/live'){liveCalls++;return Promise.resolve({data:null,feed:{source:'shioaji',status:'waiting',subscribed:200,symbols:200,quoted:0}});}
  return new Promise((_,reject)=>rejectHistory=reject);
 }});
 const pending=ui.loadHeatmap();await click();await click();assert.equal(liveCalls,1);
 rejectHistory(Error('obsolete history failure'));await pending;
 assert.doesNotMatch(ui.heatPage(),/obsolete history failure/);assert.equal(ui.heatBusy(),false);
 timers.forEach(fn=>fn());await Promise.resolve();assert.equal(liveCalls,2,'the live timer must remain active after cancelled initial history');
});
test('temporary live request failures remain eligible for automatic retry',async()=>{
 let calls=0;ui.initHeatmap({state:()=>({capabilities:{stream:'shioaji'},tokenConfigured:false,job:{running:false}}),redraw(){},api:async()=>{calls++;throw Error('temporary network failure');}});
 await ui.loadLive();assert.equal(calls,1);timers.forEach(fn=>fn());await Promise.resolve();assert.equal(calls,2);
});
