import test from 'node:test';import assert from 'node:assert/strict';
import {createNewsHealth,newsSourceInfo} from '../lib/news-health.mjs';
const mod=await import('../lib/news-poll.mjs').catch(()=>({}));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function setup(){assert.equal(typeof mod.createNewsPoller,'function');let at=1000,current=true,persisted,results=[];const health=createNewsHealth();const poller=mod.createNewsPoller({now:()=>at});const poll=(id,request,interval=300000)=>poller.poll({id,interval,health,request,isCurrent:()=>current,onAttempt:()=>persisted=structuredClone(health),onResult:(rows,success)=>results.push({id,rows,success})});return{poll,health,results,clock:t=>at=t,stale:()=>current=false,saved:()=>persisted};}
test('five-minute cooldown covers success, empty response and failure; skipped polls preserve health',async()=>{
 for(const outcome of ['data','empty','error']){const x=setup();let calls=0;const request=async()=>{calls++;if(outcome==='error')throw Error('offline');return outcome==='empty'?[]:[{title:'合成'}];};await x.poll('technews',request);const before=structuredClone(x.health);x.clock(300999);assert.equal(await x.poll('technews',request),false);assert.equal(calls,1);assert.deepEqual(x.health,before);assert.equal(x.results.length,1);x.clock(301000);await x.poll('technews',request);assert.equal(calls,2);}
});
test('attempt reservation persists before fetch and survives a restart even if the first response is pending',async()=>{
 const x=setup(),hold=deferred();const p=x.poll('ltn',()=>hold.promise);assert.equal(x.saved().ltn.lastAttempt,1000);let calls=0;const restored=createNewsHealth(x.saved()),other=mod.createNewsPoller({now:()=>2000});assert.equal(await other.poll({id:'ltn',interval:300000,health:restored,request:async()=>{calls++;return[];},isCurrent:()=>true,onAttempt:()=>{},onResult:()=>{}}),false);assert.equal(calls,0);hold.resolve([]);await p;
});
test('slow RSS does not hold cnyes; pending and obsolete generation cannot publish rows or success',async()=>{
 const x=setup(),hold=deferred();const p=x.poll('technews',()=>hold.promise);assert.equal(await x.poll('technews',async()=>{throw Error('duplicate request');}),false);await x.poll('cnyes',async()=>[{title:'new'}],60000);assert.deepEqual(x.results.map(r=>r.id),['cnyes']);x.clock(61000);await x.poll('cnyes',async()=>[],60000);assert.equal(x.results.length,2);x.stale();hold.resolve([{title:'stale'}]);await p;assert.equal(x.health.technews.lastSuccess,null);assert.equal(x.results.length,2);
});
test('RSS retry display uses its actual five-minute deadline and errors remain source-specific',async()=>{
 const x=setup();await x.poll('technews',async()=>{throw Error('feed rejected');});await x.poll('ltn',async()=>[]);assert.equal(x.health.technews.error,'feed rejected');assert.equal(x.health.ltn.error,'');assert.equal(newsSourceInfo(x.health,'technews',{now:2000,interval:300000}).retryAt,301000);
});
