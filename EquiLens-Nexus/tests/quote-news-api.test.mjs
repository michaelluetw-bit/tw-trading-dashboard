import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const wait=ms=>new Promise(r=>setTimeout(r,ms));

test('charts and reminders share current Shioaji quotes, clear on reconnect, and preserve history without new subscriptions',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'quote-news-')),root=new URL('../',import.meta.url),port=4394;
 const save=(name,value)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
 const ids=Array.from({length:200},(_,i)=>String(1100+i));
 save('config.json',{version:1,setupDone:true,market:'TW',language:'zh-TW',providers:{enabled:['shioaji','finmind'],prefer:{stream:'shioaji'}},llm:{provider:'anthropic',model:'',baseUrl:'',effort:'high'},publicUrl:'',upColor:'',remote:{tunnel:'auto',pocketHosts:[],contact:'',access:{hosts:[],teamDomain:'',aud:''}}});
 save('settings.json',{autoUpdate:false,monitor:true,daytrade:{enabled:false},news:{enabled:true,scope:'all',quiet:false}});
 save('universe.json',[...ids,'2707'].map(id=>({id,name:'示意'+id,market:'上市'})));
 save('groups.json',{version:1,groups:[{id:'a',name:'示意',stockIds:ids}],stockMetadata:[]});
 save('price-alerts.json',[{id:'rule-a',stockId:'1100',kind:'above',value:99999,active:true},{id:'rule-b',stockId:'2707',kind:'above',value:99999,active:true}]);
 save('rank-fixtures.json',{'1100':{open:101,high:120,low:99,close:110,change:10,totalVolume:2,totalAmount:220000}});
 fs.mkdirSync(path.join(dir,'daily'));save('daily/1100.json',{at:Date.parse('2026-10-22T10:00:00+08:00'),rows:[['2026-10-21',100,105,95,100,10]]});
 const names=['config.json','settings.json','groups.json','price-alerts.json','daily/1100.json'],before=new Map(names.map(n=>[n,fs.readFileSync(path.join(dir,n),'utf8')]));
 const child=spawn(process.execPath,['--import','./tests/helpers/quote-news-offline.mjs','server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),EQUITY_DATA_DIR:dir,DEMO_TIME:'2026-10-22T10:00:00+08:00',SHIOAJI_BRIDGE_TOKEN:'offline-test',FINMIND_API_TOKEN:'offline-test',FUGLE_API_KEY:'',OPENAI_API_KEY:'',ANTHROPIC_API_KEY:''},stdio:['ignore','pipe','pipe']});
 let log='';child.stderr.on('data',v=>log+=v);
 try{
  await Promise.race([once(child.stdout,'data'),wait(8000).then(()=>{throw Error(log||'startup timeout');})]);
  const sourceModule=await fetch(`http://127.0.0.1:${port}/news-source.js`);assert.equal(sourceModule.status,200,'desktop must serve the shared news status module');assert.match(sourceModule.headers.get('content-type'),/javascript/);
  const get=async name=>{const r=await fetch(`http://127.0.0.1:${port}/api/`+name);const b=await r.json();assert.equal(r.status,200,b.error);return b;};
  let monitor;for(let i=0;i<60;i++){monitor=await get('monitor');if(monitor.stream.active&&monitor.news.status.at)break;await wait(200);}
  assert.equal(monitor.stream.subscribed,200);assert.match(monitor.snapshot.error,/Sponsor/);
  const transport=fs.readFileSync(path.join(dir,'transport.ndjson'),'utf8');
  const rules=await get('price-alerts');assert.equal(rules.live,true,'stream quotes make reminders live despite denied snapshots');
  assert.equal(rules.provider,'shioaji');assert.equal(rules.rules[0].close,110);assert.equal(rules.rules[0].asOf,'2026-10-22T09:59:30');
  assert.equal(rules.rules[1].close,null);assert.equal(rules.rules[1].status,'not-subscribed');
  const chart=await get('chart?id=1100&period=day');assert.equal(chart.live,true);assert.equal(chart.stream,true);assert.equal(chart.provider,'shioaji');
  assert.deepEqual(chart.bars.at(-1),['2026-10-22',101,120,99,110,2]);assert.equal(chart.todaySource,'shioaji');assert.equal(chart.todayProvisional,true);assert.equal(chart.asOf,'2026-10-22T09:59:30');
  const fm=monitor.news.status.sources.find(s=>s.provider==='finmind'),cn=monitor.news.status.sources.find(s=>s.provider==='cnyes');
  assert.match(fm.error,/Sponsor/);assert(fm.pausedUntil>fm.lastAttempt);assert.equal(fm.lastSuccess,null);assert(cn.lastSuccess>0);assert.equal(cn.lastNew,null,'seeding is not a new article');
  save('cnyes-fixture.json',{id:2});save('advance-ms.json',61000);
  for(let i=0;i<40;i++){monitor=await get('monitor');if(monitor.news.status.sources.find(s=>s.provider==='cnyes').lastNew)break;await wait(200);}
  const fm2=monitor.news.status.sources.find(s=>s.provider==='finmind'),cn2=monitor.news.status.sources.find(s=>s.provider==='cnyes');
  assert.equal(fm2.lastAttempt,fm.lastAttempt);assert.equal(fm2.error,fm.error,'other source success cannot erase paused error');assert(cn2.lastNew>0);
  const seenAt=JSON.parse(fs.readFileSync(path.join(dir,'news-seen.json'),'utf8')).at;
  save('cnyes-fixture.json',{fail:true});save('advance-ms.json',122000);
  for(let i=0;i<40;i++){monitor=await get('monitor');if(monitor.news.status.sources.find(s=>s.provider==='cnyes').error)break;await wait(200);}
  const failedNews=monitor.news.status.sources.find(s=>s.provider==='cnyes');assert.match(failedNews.error,/503/);assert.equal(failedNews.lastSuccess,cn2.lastSuccess);assert(failedNews.retryAt>failedNews.lastAttempt);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'news-seen.json'),'utf8')).at,seenAt,'both sources unavailable must not advance the dedup scan clock');
  fs.writeFileSync(path.join(dir,'disconnect'),'');await wait(800);
  const down=await get('price-alerts');assert.equal(down.live,false);assert.equal(down.rules[0].close,null);assert.equal(down.feed.status,'disconnected');
  assert.equal((await get('chart?id=1100&period=day')).today,null);
  fs.writeFileSync(path.join(dir,'no-quotes'),'');fs.unlinkSync(path.join(dir,'disconnect'));
  let waiting;for(let i=0;i<60;i++){waiting=await get('price-alerts');if(waiting.feed.status==='waiting')break;await wait(200);}
  assert.equal(waiting.feed.status,'waiting');assert.equal(waiting.rules[0].close,null,'prior session quote must not revive after heartbeat');
  const again=await get('chart?id=1100&period=day');assert.equal(again.quote,null);assert.equal(again.today,null);assert.equal(again.asOf,null);assert.equal(again.live,false);
  // Quote-only consumers never subscribe, fetch a snapshot, or persist an intraday bar.
  const nowTransport=fs.readFileSync(path.join(dir,'transport.ndjson'),'utf8');assert.equal((transport.match(/subscribe/g)||[]).length,(nowTransport.match(/subscribe/g)||[]).length/2,'only the simulated reconnect repeats the same subscription batches');
  for(const [name,bytes] of before)assert.equal(fs.readFileSync(path.join(dir,name),'utf8'),bytes,name+' preserved');
  // A result from the former provider configuration must not pause the new one.
  const state=await get('state'),resetProviders=async()=>{const r=await fetch(`http://127.0.0.1:${port}/api/providers`,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':state.csrf},body:JSON.stringify({enabled:['shioaji','finmind'],prefer:{stream:'shioaji'}})});assert.equal(r.status,200);};
  fs.writeFileSync(path.join(dir,'hold-news'),'');await resetProviders();save('advance-ms.json',183000);
  for(let i=0;i<40&&!fs.existsSync(path.join(dir,'news-request-started'));i++)await wait(200);
  assert(fs.existsSync(path.join(dir,'news-request-started')),'controlled old news request must be pending');
  await resetProviders();fs.writeFileSync(path.join(dir,'release-news'),'');await wait(600);
  const changed=(await get('monitor')).news.status.sources.find(s=>s.provider==='finmind');assert.equal(changed.pausedUntil,null,'an obsolete request cannot reapply the old-key pause');
 }finally{child.kill();await once(child,'exit');fs.rmSync(dir,{recursive:true,force:true});}
});

test('Shioaji reminders cannot fire from a snapshot outside the active 200-symbol quote scope',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'quote-rule-source-')),save=(name,v)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(v));
 const ids=Array.from({length:200},(_,i)=>String(1100+i));
 save('config.json',{version:1,setupDone:true,market:'TW',providers:{enabled:['shioaji','finmind'],prefer:{stream:'shioaji'}}});
 save('settings.json',{autoUpdate:false,monitor:true,daytrade:{enabled:false}});
 save('universe.json',[...ids,'2707'].map(id=>({id,name:'示意'+id,market:'上市'})));
 save('groups.json',{version:1,groups:[{id:'a',name:'示意',stockIds:ids}],stockMetadata:[]});
 save('price-alerts.json',[{id:'outside',stockId:'2707',kind:'above',value:50,active:true}]);
 save('snapshot-fixture.json',[{stock_id:'2707',date:'2026-10-22 09:59:30',close:100,change_price:1,total_volume:2,total_amount:200000}]);
 const child=spawn(process.execPath,['--import','./tests/helpers/quote-news-offline.mjs','server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'4394',EQUITY_DATA_DIR:dir,DEMO_TIME:'2026-10-22T10:00:00+08:00',SHIOAJI_BRIDGE_TOKEN:'offline-test',FINMIND_API_TOKEN:'offline-test',FUGLE_API_KEY:''},stdio:['ignore','pipe','pipe']});
 try{
  await once(child.stdout,'data');const get=async p=>(await fetch('http://127.0.0.1:4394/api/'+p)).json();
  let monitor;for(let i=0;i<40;i++){monitor=await get('monitor');if(monitor.lastAt&&monitor.stream.active)break;await wait(200);}
  assert(monitor.lastAt);assert.equal(monitor.stream.subscribed,200);
  const rules=await get('price-alerts');assert.equal(rules.rules[0].active,true,'a snapshot cannot fire and disable an unsubscribed Shioaji rule');assert.equal(rules.rules[0].status,'not-subscribed');assert.equal(rules.live,false);
  assert.equal((await get('alerts')).alerts.filter(a=>a.type==='custom').length,0);
 }finally{child.kill();await once(child,'exit');fs.rmSync(dir,{recursive:true,force:true});}
});
