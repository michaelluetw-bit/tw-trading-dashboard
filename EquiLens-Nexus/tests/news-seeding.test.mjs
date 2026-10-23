import test from 'node:test';import assert from 'node:assert/strict';import * as news from '../lib/newswatch.mjs';
const scope=new Set(['2330']);const row=(title,source='科技新報',link='https://technews.tw/'+title)=>({stock_id:'2330',title,source,link,date:'2026-10-23'});
test('a newly added RSS source seeds once; subsequent five-minute batches notify and deduplicate across publishers',()=>{
 assert.equal(typeof news.scanNewsSource,'function');const state=news.createNewsState({at:1000,seen:{},sources:['cnyes']});
 assert.equal(news.scanNewsSource(state,'technews',[row('舊文章')],{scope,now:2000}).fresh.length,0);
 const restored=news.createNewsState(news.saveNewsState(state));assert.equal(news.scanNewsSource(restored,'technews',[row('新文章')],{scope,now:302000}).fresh.length,1);
 assert.equal(news.scanNewsSource(restored,'ltn',[row('新文章','自由財經','https://ec.ltn.com.tw/new')],{scope,now:303000}).fresh.length,0);
 assert.equal(news.scanNewsSource(restored,'technews',[row('另一篇')],{scope,now:604000}).fresh.length,1);
 assert.equal(news.scanNewsSource(restored,'technews',[row('停用後文章')],{scope,now:1304001}).fresh.length,0);
});
test('successful empty first response must not arm old articles for notification; FinMind existing semantics remain',()=>{
 assert.equal(typeof news.scanNewsSource,'function');const state=news.createNewsState({at:1000});news.scanNewsSource(state,'technews',[],{scope,now:2000});assert.equal(state.sources.has('technews'),false);assert.equal(news.scanNewsSource(state,'technews',[row('首次相關文章')],{scope,now:302000}).fresh.length,0);
 assert.equal(news.scanNewsSource(state,'finmind',[row('FinMind新文','FinMind')],{scope,now:303000}).fresh.length,1);
});

test('a frozen resume decision seeds every source regardless of empty/late completion order',()=>{
 for(const order of [['technews','cnyes'],['cnyes','technews']]){
  const state=news.createNewsState({at:1000,seen:{},sources:['cnyes','technews','ltn']});
  const resumedAt=602000,observed=[];
  for(const id of order)observed.push(...news.scanNewsSource(state,id,id==='technews'?[]:[row('停用期間舊聞','鉅亨網')],{scope,now:resumedAt,forceSeed:true}).fresh);
  assert.equal(observed.length,0,'one empty success must not unseed the other response');
  assert.equal(news.scanNewsSource(state,'cnyes',[row('下一輪真正新文','鉅亨網')],{scope,now:662000,forceSeed:false}).fresh.length,1);
 }
});
test('first FinMind response remains seeded after an empty cnyes response has updated global time',()=>{
 const state=news.createNewsState();
 news.scanNewsSource(state,'cnyes',[],{scope,now:1000,forceSeed:true});
 assert.equal(news.scanNewsSource(state,'finmind',[row('首次FinMind舊聞','FinMind')],{scope,now:2000,forceSeed:true}).fresh.length,0);
 assert.equal(news.scanNewsSource(state,'finmind',[row('FinMind下一輪新文','FinMind')],{scope,now:62000,forceSeed:false}).fresh.length,1);
});
