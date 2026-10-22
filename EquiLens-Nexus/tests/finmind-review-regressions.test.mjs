import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccess} from '../lib/finmind-access.mjs';
import {createCredentialLifecycle} from '../lib/finmind-lifecycle.mjs';
import {createFinmindTransport} from '../lib/providers/finmind.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function accessState(){let saved;const access=createAccess({load:()=>saved,save:s=>saved=s,now:()=>1000});access.initialize({present:true});return access;}
test('P2-1 only a missing state may migrate; persisted null, arrays and primitives stay disabled',()=>{
 for(const stored of [null,[],false,0,'text']){let saved;const a=createAccess({load:()=>stored,save:s=>saved=s});a.initialize({present:true});assert.equal(a.view().credential,'disabled',JSON.stringify(stored));assert.throws(()=>a.capture('daily'),e=>e.code==='auth');assert.equal(saved.credential,'disabled');}
 const missing=createAccess({load:()=>undefined,save:()=>{}});missing.initialize({present:true});assert.equal(missing.view().credential,'legacy_unverified');
});
for(const operation of ['save','remove','save-failure'])test(`P2-2 provider retry waits for deferred ${operation} and cannot strand changing`,async()=>{
 const a=accessState(),entered=deferred(),release=deferred();let token='old';
 const life=createCredentialLifecycle({access:a,readSecret:async()=>token,envManaged:()=>false,validate:async()=>({tier:'unknown'}),saveSecret:async v=>{entered.resolve();await release.promise;if(operation==='save-failure')throw Error('fake storage failure');token=v;},deleteSecret:async()=>{entered.resolve();await release.promise;token='';}});
 const change=operation==='remove'?life.remove():life.replace('new');const outcome=change.then(()=>null,e=>e);await entered.promise;
 // The fallback is the pre-fix server path, allowing this regression to reproduce its real race.
 const retry=life.retryOperations?life.retryOperations():Promise.resolve(a.resetOperationPauses());release.resolve();const error=await outcome;await retry;
 assert.equal(a.view().credential,operation==='remove'?'missing':operation==='save-failure'?'disabled':'valid');assert.equal(token,operation==='remove'?'':operation==='save-failure'?'old':'new');
 if(operation==='save-failure')assert.match(error.message,/儲存未完成/);else assert.equal(error,null);
});
test('P2-2 serialized operation retries preserve auth/disabled/quota and discard old in-flight failures',async()=>{
 const a=accessState();const life=createCredentialLifecycle({access:a});assert.equal(typeof life.retryOperations,'function');
 const old=a.capture('news');await life.retryOperations();a.record(old,{kind:'plan'});assert.doesNotThrow(()=>a.capture('news'));
 a.record(a.capture('daily'),{kind:'quota',retryAt:3601000});await life.retryOperations();assert.throws(()=>a.capture('news'),e=>e.code==='quota');
 const b=accessState(),other=createCredentialLifecycle({access:b});b.record(b.capture('daily'),{kind:'auth'});await other.retryOperations();assert.equal(b.view().credential,'auth_failed');await other.disable();await other.retryOperations();assert.equal(b.view().credential,'disabled');
});
test('P2-3 daily sends remain 7000ms apart after a slow secret read',async()=>{
 const a=accessState();let at=10000,reads=0;const sent=[],waits=[];
 const c=createFinmindTransport({access:a,now:()=>at,readSecret:async()=>{if(++reads===1)at+=10000;return 'synthetic';},wait:async ms=>{waits.push(ms);at+=ms;},fetcher:async()=>{sent.push(at);return Response.json({status:200,data:[]});}});
 await c.request('TaiwanStockPrice',{}, {interval:7000});await c.request('TaiwanStockNews',{}, {interval:7000});assert.deepEqual(sent,[20000,27000]);assert.deepEqual(waits,[7000]);
});
test('P2-3 snapshots neither wait on nor reset the daily send interval',async()=>{
 const a=accessState(),entered=deferred(),release=deferred();let at=10000,reads=0;const daily=[],snapshots=[];
 const c=createFinmindTransport({access:a,now:()=>at,readSecret:async()=>{if(++reads===1)at+=10000;return 'synthetic';},wait:async ms=>{at+=ms;},fetcher:async url=>{if(String(url).includes('tick_snapshot')){snapshots.push(at);return Response.json({status:200,data:[]});}daily.push(at);if(daily.length===1){entered.resolve();await release.promise;}return Response.json({status:200,data:[]});}});
 const first=c.request('TaiwanStockPrice',{}, {interval:7000});await entered.promise;at=23000;await c.tickSnapshot();release.resolve();await first;await c.request('TaiwanStockNews',{}, {interval:7000});assert.deepEqual(snapshots,[23000]);assert.deepEqual(daily,[20000,27000]);
});
test('P2-2 failed persistence recovery cannot leave changing when its generation was invalidated',async()=>{
 const a=accessState(),entered=deferred(),release=deferred();const life=createCredentialLifecycle({access:a,envManaged:()=>false,validate:async()=>({}),saveSecret:async()=>{entered.resolve();await release.promise;throw Error('fake failure');}});
 const pending=life.replace('new').catch(e=>e);await entered.promise;a.resetOperationPauses();release.resolve();const error=await pending;assert.equal(a.view().credential,'disabled');assert.match(error.message,/儲存未完成/);
});
