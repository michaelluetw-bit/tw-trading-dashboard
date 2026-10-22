import test from 'node:test';
import assert from 'node:assert/strict';
import * as heat from '../lib/heatmap.mjs';
const today='2026-10-22', now=Date.parse(today+'T10:00:00+08:00');
const universe=[{id:'2330',name:'示意甲',sector:'半導體業',market:'上市'},{id:'2317',name:'示意乙',sector:'其他電子業',market:'上市'},{id:'2454',name:'未訂閱',sector:'半導體業',market:'上市'},{id:'0050',name:'ETF',sector:'ETF',market:'上市'}];
const row=(id,date=today+' 09:59:30',extra={})=>({stock_id:id,date,close:110,change_price:10,total_amount:220000,total_volume:2,...extra});
const options={today,now,universe,subscribedIds:new Set(['2330','2317','0050']),connected:true,subscribedCount:3,alive:now,enabled:true,open:true};
function build(rows,extra={}){assert.equal(typeof heat.buildStreamHeatmap,'function','stream heatmap is supported');return heat.buildStreamHeatmap(rows,{...options,...extra});}
test('only subscribed ordinary stocks count, latest valid quote defines time, amounts and lots stay unchanged',()=>{
 const r=build([row('2330'),row('2317',today+' 09:59:50',{close:0}),row('2454'),row('0050')]);
 assert.equal(r.feed.status,'live');assert.equal(r.feed.quoted,1);assert.equal(r.feed.symbols,3);
 assert.equal(r.data.scope,'research');assert.equal(r.data.source,'shioaji');assert.equal(r.data.total.money,220000);
 assert.equal(r.data.sectors[0].stocks[0].volume,2);assert.equal(r.data.asOf,today+'T09:59:30');
});
test('yesterday, invalid and empty rows cannot become a current chart',()=>{
 for(const rows of [[],[row('2330','2026-10-21 13:30:00')],[row('2330',today+' 09:59:30',{total_amount:0})]]){
 const r=build(rows);assert.equal(r.data,null);assert.equal(r.feed.status,'waiting');assert.equal(r.feed.asOf,null);}
});
test('disconnection, heartbeat timeout, disabled monitor and closed session never show a live chart',()=>{
 for(const [extra,status] of [[{connected:false},'disconnected'],[{alive:now-75000},'stale'],[{enabled:false},'paused'],[{open:false},'closed']]){
 const r=build([row('2330')],extra);assert.equal(r.data,null);assert.equal(r.feed.status,status);assert.equal(r.feed.asOf,today+'T09:59:30');}
});
test('subscription removal excludes old cached rows and does not mutate the shared map',()=>{
 const rows=[row('2330'),row('2317')],before=structuredClone(rows);
 const r=build(rows,{subscribedIds:new Set(['2317'])});assert.equal(r.data.total.count,1);assert.equal(r.data.sectors[0].stocks[0].id,'2317');assert.deepEqual(rows,before);
});
test('partial subscriptions and upstream errors are visible even while transport is healthy',()=>{
 const r=build([row('2330')],{subscribedCount:1});assert.equal(r.feed.subscribed,1);assert.equal(r.feed.symbols,3);assert.equal(r.feed.status,'partial');assert.equal(r.data.total.count,1);
 assert.equal(build([row('2330')],{subscribedCount:3,error:true}).feed.status,'partial');
});
