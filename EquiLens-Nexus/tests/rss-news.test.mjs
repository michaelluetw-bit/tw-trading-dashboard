import test from 'node:test';
import assert from 'node:assert/strict';
const rss=await import('../lib/providers/rss-news.mjs').catch(()=>({}));
const stocks=[{id:'2002',name:'中鋼',market:'上市'},{id:'2014',name:'中鴻',market:'上市'},{id:'3045',name:'台灣大',market:'上市'},{id:'2330',name:'台積電',market:'上市'},{id:'2303',name:'聯電',market:'上市'},{id:'5347',name:'世界',market:'上櫃'},{id:'1216',name:'統一',market:'上市'},{id:'2371',name:'大同',market:'上市'},{id:'2026',name:'合成鋼鐵',market:'上市'},{id:'9991',name:'同名公司',market:'上市'},{id:'9992',name:'同名公司',market:'上櫃'},{id:'9993',name:'桃園',market:'上市'}];
const scope=new Set(stocks.map(s=>s.id));
const item=({title='台積電擴大投資',link='https://technews.tw/2026/10/23/example/',date='Fri, 23 Oct 2026 01:00:00 GMT',category='',description=''}={})=>`<item><title><![CDATA[${title}]]></title><link>${link.replaceAll('&','&amp;')}</link><pubDate>${date}</pubDate>${category?`<category><![CDATA[${category}]]></category>`:''}<description><![CDATA[${description}]]></description></item>`;
const feed=items=>`<?xml version="1.0"?><rss version="2.0"><channel><title>合成測試</title>${items}</channel></rss>`;
const parse=(xml,id='technews')=>{assert.equal(typeof rss.parseRssNews,'function');return rss.parseRssNews(id,xml,{stocks,scope,now:Date.parse('2026-10-23T02:00:00Z')});};
test('RSS uses XML structure, CDATA and source-owned original URLs; stores no description',()=>{
 const rows=parse(feed(item({title:'台積電 & AI',description:'<p>合成摘要</p>'})));assert.deepEqual(rows,[{stock_id:'2330',title:'台積電 & AI',link:'https://technews.tw/2026/10/23/example/',date:'2026-10-23T01:00:00.000Z',source:'科技新報'}]);
 assert.equal(parse(feed(item({link:'https://ec.ltn.com.tw/article/123'})),'ltn')[0].source,'自由財經');
});
test('RSS rejects malformed XML, non-feed documents, DOCTYPE and ENTITY but accepts an empty channel',()=>{
 assert.deepEqual(parse(feed('')),[]);
 for(const xml of ['<rss><channel></rss>','<html><body>empty</body></html>','<!DOCTYPE rss><rss><channel/></rss>','<!DOCTYPE rss [<!ENTITY x "台積電">]><rss><channel/></rss>','<rss/>'])assert.throws(()=>parse(xml),/RSS/);
});
test('RSS ignores unsafe links, misleading host suffixes, credentials and invalid/future dates',()=>{
 for(const link of ['javascript:alert(1)','https://technews.tw.evil.test/article','https://user:password@technews.tw/article','https://news.ltn.com.tw/a','https://technews.tw:444/a'])assert.deepEqual(parse(feed(item({link}))),[]);
 for(const date of ['not a date','0','Fri, 23 Oct 2030 01:00:00 GMT'])assert.deepEqual(parse(feed(item({date}))),[]);
});
test('explicit codes need stock context; years, prices, bare numbers and out-of-scope symbols do not match',()=>{
 for(const title of ['合成公司（2330）新計畫','合成公司(2330)新計畫','股票代號：2303 新公告','台股 2330.TW 新公告'])assert.equal(parse(feed(item({title})))[0]?.stock_id,title.includes('2303')?'2303':'2330');
 for(const title of ['2026年產業趨勢','展會（2026）舉辦','預算2330萬元','2330個樣本','未追蹤公司（8888）'])assert.deepEqual(parse(feed(item({title}))),[]);
});
test('short or duplicate company names never match by substring; exact unambiguous category is evidence',()=>{
 for(const title of ['世界局勢走向','統一規範公布','大同小異','同名公司擴廠','桃園工業投資'])assert.deepEqual(parse(feed(item({title}))),[]);
 assert.equal(parse(feed(item({title:'新產能公告',category:'聯電'})))[0]?.stock_id,'2303');
 assert.deepEqual(parse(feed(item({title:'新產能公告',category:'世界'}))),[]);
 assert.deepEqual(parse(feed(item({title:'產能',category:'同名公司'}))),[]);
});
test('unique names match title or plain summary only; related links and content:encoded are excluded',()=>{
 assert.equal(parse(feed(item({title:'產業消息',description:'<p>台積電提出新計畫</p>'})))[0]?.stock_id,'2330');
 assert.deepEqual(parse(feed(item({title:'產業消息',description:'<a href="https://technews.tw/x">延伸閱讀：台積電擴廠</a>'}))),[]);
 assert.deepEqual(parse(feed(item({title:'產業消息'}) .replace('</item>','<content:encoded xmlns:content="urn:content"><![CDATA[台積電完整文章]]></content:encoded></item>'))),[]);
 const other=new Set(['2303']);assert.deepEqual(rss.parseRssNews('technews',feed(item()),{stocks,scope:other}),[]);
});
test('RSS truncates the number of items and rejects oversized decoded XML',()=>{
 assert.equal(parse(feed(Array.from({length:110},(_,i)=>item({link:`https://technews.tw/item/${i}`})).join(''))).length,100);
 assert.throws(()=>parse(feed(item({description:'x'.repeat(1024*1024)}))),/RSS/);
});
test('transport fixes URL, denies redirects, limits streamed bytes, uses timeout and distinguishes HTTP/parse failures',async()=>{
 assert.equal(typeof rss.fetchRssNews,'function');let call;
 const fetcher=async(url,options)=>{call={url,options};return new Response(feed(item()));};
 const rows=await rss.fetchRssNews('technews',{stocks,scope,fetcher});assert.equal(rows.length,1);assert.equal(call.url,'https://technews.tw/news-rss/');assert.equal(call.options.redirect,'error');assert.ok(call.options.signal instanceof AbortSignal);
 await assert.rejects(rss.fetchRssNews('unknown',{stocks,scope,fetcher}),/RSS/);
 await assert.rejects(rss.fetchRssNews('ltn',{stocks,scope,fetcher:async()=>new Response('error',{status:503})}),/RSS/);
 let cancelled=false;const oversized=new ReadableStream({start(c){c.enqueue(new Uint8Array(1024*1024));c.enqueue(new Uint8Array(1));},cancel(){cancelled=true;}});
 await assert.rejects(rss.fetchRssNews('technews',{stocks,scope,fetcher:async()=>new Response(oversized)}),/RSS/);assert.equal(cancelled,true);
 await assert.rejects(rss.fetchRssNews('technews',{stocks,scope,fetcher:async()=>{throw Error('RAW_PRIVATE_ERROR');}}),e=>!e.message.includes('RAW_PRIVATE_ERROR'));
});

test('year-shaped real symbols need explicit stock context or their matching company name',()=>{
 assert.equal(parse(feed(item({title:'中鋼（2002）鋼價上調'})))[0]?.stock_id,'2002');
 assert.equal(parse(feed(item({title:'中鴻 (2014) 新產能公告'})))[0]?.stock_id,'2014');
 assert.equal(parse(feed(item({title:'股票代號 2002 新公告'})))[0]?.stock_id,'2002');
 for(const title of ['回顧（2002）年度','年度 (2014) 結果','台灣大雨影響交通'])assert.deepEqual(parse(feed(item({title}))),[]);
 assert.deepEqual(parse(feed(item({date:'Sun, 30 Feb 2025 01:00:00 GMT'}))),[]);
});
test('unclosed or encoded recommendation links do not become summary evidence',()=>{
 for(const description of ['<a href="/related">台積電相關文章','&lt;a href="/related"&gt;台積電相關文章&lt;/a&gt;','<script>台積電程式內容'])assert.deepEqual(parse(feed(item({title:'產業消息',description}))),[]);
});
test('numeric-looking title dates and unknown listing metadata cannot create matches',()=>{
 assert.deepEqual(rss.parseRssNews('technews',feed(item()),{stocks:[{id:'2330',name:'台積電',market:'待確認'}],scope}),[]);
});
