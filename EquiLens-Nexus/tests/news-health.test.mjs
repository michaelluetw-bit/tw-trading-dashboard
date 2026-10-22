import test from 'node:test';
import assert from 'node:assert/strict';
const health=await import('../lib/news-health.mjs').catch(()=>({}));
test('source health retains a denied source across another success and retries only after its own pause',async()=>{
 assert.equal(typeof health.createNewsHealth,'function');
 const state=health.createNewsHealth(),fetchRows=health.fetchNewsSource;let calls=0;
 const denied=async()=>{calls++;throw Object.assign(Error('Sponsor denied'),{code:'plan'});};
 await fetchRows(state,'finmind',denied,{now:1000});await fetchRows(state,'cnyes',async()=>[],{now:1100});
 assert.equal(state.finmind.lastSuccess,null);assert.equal(state.finmind.error,'Sponsor denied');assert.equal(state.finmind.pausedUntil,1801000);
 await fetchRows(state,'finmind',denied,{now:2000});assert.equal(calls,1);assert.equal(state.finmind.lastAttempt,1000);
 state.finmind.lastNew=500;
 await fetchRows(state,'finmind',async()=>[],{now:1801001});assert.equal(state.finmind.error,'');assert.equal(state.finmind.pausedUntil,null);assert.equal(state.finmind.lastNew,500);assert.equal(state.finmind.lastSuccess,1801001);
 const restored=health.createNewsHealth(JSON.parse(JSON.stringify(state)));assert.deepEqual(restored,state);
});
test('transient news failures keep last success and expose next scan time',async()=>{
 assert.equal(typeof health.createNewsHealth,'function');const state=health.createNewsHealth();
 await health.fetchNewsSource(state,'cnyes',async()=>[],{now:1000});
 await health.fetchNewsSource(state,'cnyes',async()=>{throw Error('503');},{now:61000});
 const result=health.newsSourceInfo(state,'cnyes',{enabled:true,now:62000});
 assert.equal(result.lastSuccess,1000);assert.equal(result.error,'503');assert.equal(result.retryAt,121000);assert.equal(result.status,'error');
 assert.equal(health.newsSourceInfo(state,'cnyes',{enabled:false,now:62000}).status,'disabled');
});

test('E05/P02 global FinMind cooldown extends its displayed pause without changing other sources',async()=>{
 const state=health.createNewsHealth();await health.fetchNewsSource(state,'finmind',async()=>{throw Object.assign(new Error('rejected'),{code:'forbidden'});},{now:1000});
 const info=health.newsSourceInfo(state,'finmind',{enabled:true,now:1001,retryAt:3601000});assert.equal(info.pausedUntil,3601000);assert.equal(info.retryAt,3601000);assert.equal(health.newsSourceInfo(state,'cnyes',{enabled:true,now:1001}).status,'waiting');
});
