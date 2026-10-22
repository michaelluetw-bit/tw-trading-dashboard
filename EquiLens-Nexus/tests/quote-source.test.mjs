import test from 'node:test';
import assert from 'node:assert/strict';
import * as ui from '../public/quote-source.js';
test('stream status and snapshot errors are separate, source names are accurate and escaped',()=>{
 assert.equal(typeof ui.boardFeedNotice,'function');
 const good=ui.boardFeedNotice({provider:'shioaji',status:'live',subscribed:200,planned:200,quoted:199,asOf:'2026-10-22T10:01:02'});
 assert.match(good,/Shioaji/);assert.match(good,/200 \/ 200/);assert.match(good,/10:01:02/);assert.doesNotMatch(good,/富果|FinMind/);
 const error=ui.snapshotErrorNotice({snapshot:{provider:'finmind',error:'<script>not Sponsor</script>'}});assert.match(error,/data-snapshot-error/);assert.match(error,/FinMind/);assert.doesNotMatch(error,/<script>/);
});
test('request failures and delayed prior-day boards clear quotes without erasing historical daily metadata',()=>{
 assert.equal(typeof ui.boardRequestFailed,'function');
 const old={provider:'shioaji',date:'2026-10-22',live:true,asOf:'2026-10-22T10:00:00',feed:{provider:'shioaji',status:'live'},stocks:[{id:'2330',status:'live',quote:{close:110},spark:[110],sparkX:[.5],daily:{price:100,asOf:'2026-10-21'}}]};
 const failed=ui.boardRequestFailed(old);assert.equal(failed.feed.status,'error');assert.equal(failed.stocks[0].quote,null);assert.deepEqual(failed.stocks[0].spark,[]);assert.equal(failed.stocks[0].daily.price,100);assert.equal(old.stocks[0].quote.close,110);
 const next=ui.currentBoardResponse(old,'2026-10-23');assert.equal(next.feed.status,'waiting');assert.equal(next.stocks[0].quote,null);assert.equal(next.feed.asOf,null);
});
test('slow board polling coalesces requests, reports failures, times out and recovers',async()=>{
 assert.equal(typeof ui.createBoardLoader,'function');
 let calls=0,failRequest,received=[],errors=[];
 const load=ui.createBoardLoader({group:()=>'',request:()=>{calls++;return calls>2?Promise.resolve({group:'recovered'}):new Promise((_,reject)=>failRequest=reject);},receive:x=>received.push(x),fail:e=>errors.push(e.message),today:()=> '2026-10-22',timeoutMs:15});
 const a=load(),b=load();assert.equal(a,b,'same-group requests share the in-flight result');await Promise.resolve();assert.equal(calls,1);
 failRequest(Error('network lost'));await a;assert.deepEqual(errors,['network lost']);
 const timed=load();await timed;assert.equal(errors.length,2);assert.match(errors[1],/逾時/);await load();assert.deepEqual(received,[{group:'recovered'}]);
});
test('a newer group result owns presentation even when the old group finishes later',async()=>{
 assert.equal(typeof ui.createBoardLoader,'function');
 let group='A';const pending=new Map(),received=[];
 const load=ui.createBoardLoader({group:()=>group,request:g=>new Promise(resolve=>pending.set(g,resolve)),receive:x=>received.push(x),fail:e=>{throw e;},today:()=> '2026-10-22'});
 const a=load();group='B';const b=load();await Promise.resolve();pending.get('B')({group:'B'});await b;pending.get('A')({group:'A'});await a;assert.deepEqual(received,[{group:'B'}]);
});
