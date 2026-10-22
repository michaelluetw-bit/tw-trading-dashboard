import test from 'node:test';
import assert from 'node:assert/strict';
const ui=await import('../public/news-source.js').catch(()=>({}));
import * as quote from '../public/quote-source.js';
test('news health renders both source errors and retry times independently, escaping provider messages',()=>{
 assert.equal(typeof ui.newsSourcesHTML,'function');
 const html=ui.newsSourcesHTML({status:{sources:[{provider:'finmind',status:'paused',lastSuccess:1,lastNew:null,error:'<script>Sponsor</script>',retryAt:9},{provider:'cnyes',status:'ok',lastSuccess:2,lastNew:3,error:'',retryAt:null}]}},{time:v=>'time-'+v});
 assert.match(html,/data-news-source="finmind"/);assert.match(html,/data-news-source="cnyes"/);assert.match(html,/time-9/);assert.match(html,/time-3/);assert.match(html,/最後成功/);assert.match(html,/最後新文/);assert.doesNotMatch(html,/<script>/);
});
test('a failed or prior-day chart clears live quotes and provisional bars while retaining stored history',()=>{
 assert.equal(typeof quote.chartRequestFailed,'function');assert.equal(typeof quote.currentChartResponse,'function');
 const d={provider:'shioaji',date:'2026-10-22',live:true,stream:true,asOf:'2026-10-22T10:00:00',feed:{status:'live'},quote:{close:110,date:'2026-10-22'},today:'2026-10-22',todayProvisional:true,todaySource:'shioaji',bars:[['2026-10-21',100,105,95,100,10],['2026-10-22',101,120,99,110,2]]};
 const failed=quote.chartRequestFailed(d);assert.equal(failed.live,false);assert.equal(failed.quote,null);assert.equal(failed.asOf,null);assert.equal(failed.today,null);assert.equal(failed.bars.length,1);assert.equal(d.bars.length,2);
 assert.equal(quote.currentChartResponse(d,'2026-10-23').quote,null);
 assert.equal(quote.currentChartResponse({...d,feed:{status:'disconnected'}},'2026-10-22').quote,null);
 const five={...d,period:'5m',today:null,todayProvisional:false,bars:[['2026-10-22 09:55',105,110,104,110,2]],session:['2026-10-22',101,120,99,110,200]};
 const failedFive=quote.chartRequestFailed(five);assert.equal(failedFive.session,null,'a five-minute bar must not replace the full-day quote header');assert.equal(failedFive.bars.length,1);
});
test('chart requests coalesce, time out, recover and ignore an obsolete stock response',async()=>{
 assert.equal(typeof quote.createChartLoader,'function');
 const pending=new Map(),received=[],errors=[];let calls=0;
 const load=quote.createChartLoader({request:intent=>{calls++;return new Promise(resolve=>pending.set(intent.id,resolve));},receive:d=>received.push(d),fail:e=>errors.push(e.message),timeoutMs:20});
 const first=load({id:'1100',period:'day'});assert.equal(load({id:'1100',period:'day'}),first);await first;assert.equal(calls,1);assert.equal(errors.length,1);assert.match(errors[0],/逾時/);
 const old=load({id:'1100',period:'day'}),current=load({id:'1101',period:'day'});await Promise.resolve();pending.get('1101')('new');await current;pending.get('1100')('old');await old;assert.deepEqual(received,['new']);
});
test('reminder failures and prior-day responses clear quotes without changing rule settings',()=>{
 assert.equal(typeof quote.priceRulesRequestFailed,'function');assert.equal(typeof quote.currentPriceRulesResponse,'function');
 const info={provider:'shioaji',date:'2026-10-22',live:true,feed:{status:'live'},rules:[{id:'a',stockId:'1100',kind:'above',value:100,active:true,close:110,change:10,asOf:'2026-10-22T09:59:30',status:'live'},{id:'b',stockId:'2707',value:50,active:true,close:null,status:'not-subscribed'}]};
 const failed=quote.priceRulesRequestFailed(info);assert.equal(failed.live,false);assert.equal(failed.rules[0].close,null);assert.equal(failed.rules[0].asOf,null);assert.equal(failed.rules[0].status,'error');assert.equal(failed.rules[0].active,true);assert.equal(failed.rules[0].value,100);assert.equal(failed.rules[1].status,'not-subscribed');
 assert.equal(quote.currentPriceRulesResponse(info,'2026-10-23').rules[0].close,null);assert.equal(info.rules[0].close,110);
 assert.equal(quote.currentPriceRulesResponse({...info,feed:{status:'disconnected'}},'2026-10-22').rules[0].close,null);
});
