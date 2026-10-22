import test from 'node:test';
import assert from 'node:assert/strict';
import * as rank from '../lib/grouprank.mjs';

const groups=[{id:'a',name:'A',stockIds:['2330','2317']},{id:'b',name:'B',stockIds:['2454']}];
const quotes=new Map([
 ['2330',{name:'甲',close:110,rate:10,amount:40000000,time:'2026-10-22T10:00:01'}],
 ['2317',{name:'乙',close:90,rate:-10,amount:10000000,time:'2026-10-22T10:00:02'}],
 ['2454',{name:'丙',close:120,rate:20,amount:50000000,time:'2026-10-22T10:00:03'}],
]);
const record=(g=groups,q=quotes,extra={})=>rank.groupRankingRecord(g,q,{date:'2026-10-22',source:'live',provider:'shioaji',...extra});

test('stream rank adapter rejects missing change/amount rather than creating flat quotes',()=>{
 assert.equal(typeof rank.quotesFromStream,'function');
 const row={stock_id:'2330',close:110,change_price:10,total_amount:40000000,date:'2026-10-22T10:00:01'};
 const rows=[row,...[null,undefined,''].map((change_price,i)=>({...row,stock_id:String(2400+i),change_price})),
  ...[null,undefined,'',0,-1,Infinity].map((total_amount,i)=>({...row,stock_id:String(2500+i),total_amount}))];
 const q=rank.quotesFromStream(rows,new Map([['2330',{name:'甲'}]]));
 assert.deepEqual([...q], [['2330',{name:'甲',close:110,rate:10,amount:40000000,time:'2026-10-22T10:00:01'}]]);
});

test('rank record preserves the formula and suppresses moves for legacy or different coverage',()=>{
 assert.equal(typeof rank.groupRankingRecord,'function');
 const legacy={date:'2026-10-21',stocks:3,quoted:2,groups:[{id:'a',rank:1},{id:'b',rank:2}]};
 const r=record(groups,quotes,{previous:legacy});
 assert.deepEqual(r.groups.map(g=>[g.id,g.rank,g.score]),[['b',1,20],['a',2,3.33]]);
 assert(r.groups.every(g=>g.move===null&&g.prevRank===null));
 assert.equal(r.comparison.compatible,false);assert.equal(r.comparison.reason,'unknown-scope');
 assert.equal(r.comparison.previousQuoted,2);assert.equal(r.quoted,3);assert.equal(r.asOf,'2026-10-22T10:00:03');
 const previous={...record(),date:'2026-10-21',groups:[{id:'a',rank:1},{id:'b',rank:2}]};
 const same=record([...groups].reverse().map(g=>({...g,stockIds:[...g.stockIds].reverse()})),quotes,{previous});
 assert.equal(same.comparison.compatible,true);assert.deepEqual(same.groups.map(g=>[g.id,g.move]),[['b',1],['a',-1]]);
 const partial=record(groups,new Map([...quotes].slice(0,2)),{previous});
 assert.equal(partial.comparison.reason,'coverage-changed');assert(partial.groups.every(g=>g.move===null));
 const changed=record([{...groups[0],stockIds:['2330','9999']},groups[1]],quotes,{previous});
 assert.equal(changed.comparison.reason,'scope-changed');assert(changed.groups.every(g=>g.move===null));
  const rules=record(groups,quotes,{previous:{...previous,rules:{minShare:0.01,minAmount:10000000}}});
  assert.equal(rules.comparison.reason,'rules-changed');assert(rules.groups.every(g=>g.move===null));
});

test('legacy history is displayed without unverified moves and is never modified in place',()=>{
 assert.equal(typeof rank.historicalRanking,'function');
 const original={date:'2026-10-21',source:'close',stocks:3,quoted:2,compare:{date:'2026-10-20'},groups:[{id:'a',rank:1,score:2,move:8,prevRank:9}]};
 const bytes=JSON.stringify(original),r=rank.historicalRanking(original);
 assert.equal(r.groups[0].rank,1);assert.equal(r.groups[0].score,2);assert.equal(r.groups[0].move,null);assert.equal(r.groups[0].prevRank,null);
 assert.equal(r.comparison.compatible,false);assert.equal(r.comparison.reason,'unknown-scope');assert.equal(JSON.stringify(original),bytes);
});

test('comparison coverage counts only usable ranking quotes even when the map contains a zero-amount row',()=>{
 const previous={...record(),date:'2026-10-21'};
 for(const invalid of [{amount:0},{amount:null},{amount:Infinity},{rate:NaN}]){
  const current=new Map(quotes);current.set('2454',{...quotes.get('2454'),...invalid});
  const r=record(groups,current,{previous});
  assert.equal(r.comparison.compatible,false);assert.equal(r.comparison.reason,'coverage-changed');assert.equal(r.quoted,2);
  assert(r.groups.every(g=>g.move===null));assert.equal(r.groups.find(g=>g.id==='b').rank,null);
 }
});
