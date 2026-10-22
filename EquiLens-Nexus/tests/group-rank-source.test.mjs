import test from 'node:test';
import assert from 'node:assert/strict';
const ui=await import('../public/group-rank-source.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e;});
const live={provider:'shioaji',source:'live',date:'2026-10-22',asOf:'2026-10-22T10:00:03',stocks:3,quoted:3,scopeKey:'scope',coverageKey:'coverage',
 feed:{provider:'shioaji',status:'live',subscribed:3,planned:3,quoted:3,asOf:'2026-10-22T10:00:03'},
 comparison:{compatible:false,reason:'unknown-scope',previousDate:'2026-10-21',previousQuoted:2,previousStocks:3},
 groups:[{id:'a',name:'A',stocks:3,quoted:3,used:3,score:2,rank:1,move:3,prevRank:4,amount:30000000,items:[{id:'2330',rate:2}]}]};

test('rank source and coverage show real time, coverage differences and no unverified moves',()=>{
 assert.equal(typeof ui.groupRankNotice,'function');
 const html=ui.groupRankNotice(live);
 assert.match(html,/Shioaji/);assert.match(html,/研究範圍/);assert.match(html,/10:00:03/);assert.match(html,/2 \/ 3/);assert.match(html,/3 \/ 3/);
 assert.equal(ui.canCompareGroupRank(live),false);
 assert.equal(ui.canCompareGroupRank({...live,comparison:{compatible:true}}),true);
 assert.equal(ui.canCompareGroupRank({...live,comparison:undefined}),false);
});

test('rank API failures and prior-day responses clear scores and moves without touching the old object',()=>{
 assert.equal(typeof ui.groupRankFailed,'function');
 const failed=ui.groupRankFailed(live);
 assert.equal(failed.feed.status,'error');assert.equal(failed.quoted,0);assert.equal(failed.asOf,null);assert.equal(failed.groups[0].score,null);
 assert.equal(failed.groups[0].rank,null);assert.equal(failed.groups[0].move,null);assert.deepEqual(failed.groups[0].items,[]);assert.equal(live.groups[0].score,2);
 const late=ui.currentGroupRank(live,'2026-10-23');assert.equal(late.date,'2026-10-23');assert.equal(late.groups[0].score,null);assert.equal(late.feed.status,'waiting');
 const down=ui.currentGroupRank({...live,feed:{...live.feed,status:'disconnected'}},'2026-10-22');assert.equal(down.groups[0].score,null);
});

test('ranking polling coalesces slow requests, clears on timeout and ignores late results',async()=>{
 assert.equal(typeof ui.createGroupRankLoader,'function');
 let calls=0,resolveOld;const received=[],errors=[];
 const load=ui.createGroupRankLoader({request:()=>{calls++;return calls===1?new Promise(r=>resolveOld=r):Promise.resolve(live);},today:()=> '2026-10-22',receive:r=>received.push(r),fail:e=>errors.push(e.message),timeoutMs:15});
 const a=load(),b=load();assert.equal(a,b);await a;assert.equal(calls,1);assert.equal(errors.length,1);assert.match(errors[0],/逾時/);
 await load();assert.equal(received.length,1);resolveOld({...live,asOf:'2026-10-22T09:00:00'});await Promise.resolve();assert.equal(received.length,1);
});
