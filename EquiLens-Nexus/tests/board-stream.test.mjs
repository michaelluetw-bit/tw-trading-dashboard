import test from 'node:test';
import assert from 'node:assert/strict';
import * as board from '../lib/board-stream.mjs';
const date='2026-10-22',now=Date.parse(date+'T10:00:00+08:00');
const row=(id='2330',stamp=date+' 09:59:30',extra={})=>({stock_id:id,date:stamp,close:110,change_price:10,total_volume:2,total_amount:220000,...extra});
const opts={today:date,now,enabled:true,open:true,connected:true,alive:now,since:now-1000,subscribed:2,ids:new Set(['2330','2317'])};
const build=(rows,patch={})=>{assert.equal(typeof board.boardStream,'function');return board.boardStream(rows,{...opts,...patch});};
test('board stream uses only current subscribed quotes with event time and original amount/lot units',()=>{
 const result=build([row(),row('9999'),row('2317','2026-10-21 13:30:00')]);
 assert.equal(result.feed.status,'live');assert.equal(result.feed.quoted,1);assert.equal(result.feed.asOf,date+'T09:59:30');assert.equal(result.rows.size,1);
 const q=board.streamBoardQuote(result.rows.get('2330'));assert.equal(q.source,'stream');assert.equal(q.provider,'shioaji');assert.equal(q.close,110);assert.equal(q.volume,2);assert.equal(q.amount,220000);assert.equal(q.change,10);
});
test('unhealthy streams never supply live board rows; an uninitialized heartbeat is waiting',()=>{
 for(const [patch,status] of [[{connected:false},'disconnected'],[{alive:now-75000},'stale'],[{alive:0},'waiting'],[{enabled:false},'paused'],[{open:false},'closed']]){
 const result=build([row()],patch);assert.equal(result.feed.status,status);assert.equal(result.rows.size,0);}
 assert.equal(build([]).feed.status,'waiting');
});
test('partial subscriptions are explicit; invalid prices and malformed or old timestamps are skipped',()=>{
 const result=build([row(),row('2317',date+' broken'),row('2317',date+' 10:00:00',{close:0})],{subscribed:1});
 assert.equal(result.feed.status,'partial');assert.equal(result.feed.subscribed,1);assert.equal(result.rows.size,1);
 const q=board.streamBoardQuote(row('2330',date+' 09:59:30',{change_price:null,open:null}));assert.equal(q.change,null);assert.equal(q.open,null);
});
test('minute points keep event order and do not replace a newer quote with a delayed one',()=>{
 const minutes=new Map();assert.equal(typeof board.recordBoardMinute,'function');
 board.recordBoardMinute(minutes,row());board.recordBoardMinute(minutes,row('2330',date+' 09:59:10',{close:50}));board.recordBoardMinute(minutes,row('2330',date+' 10:00:10',{close:120}));
 assert.deepEqual(board.boardSpark(minutes.get('2330'),t=>t==='09:59'?.5:.6),[[.5,110],[.6,120]]);
});
test('future-dated quotes cannot become live or poison later current quotes',()=>{
 const result=build([row('2330',date+' 13:30:00',{close:999})]);assert.equal(result.rows.size,0);assert.equal(result.feed.asOf,null);assert.equal(result.feed.status,'waiting');
 assert.equal(typeof board.validBoardQuote,'function');assert.equal(board.validBoardQuote(row('2330',date+' 13:30:00'),date,now),false);assert.equal(board.validBoardQuote(row(),date,now),true);
});
