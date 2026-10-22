import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const root=new URL('../',import.meta.url);
for (const daytradeEnabled of [false,true]) test(`Shioaji HTTP heatmap reuses subscriptions and isolates reconnects (daytrade=${daytradeEnabled})`,async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'heat-stream-'));
 const save=(name,data)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(data));
 save('config.json',{version:1,market:'TW',setupDone:true,providers:{enabled:['shioaji'],prefer:{stream:'shioaji'}}});
 save('settings.json',{autoUpdate:false,monitor:true,daytrade:{enabled:daytradeEnabled}});
 const ids=Array.from({length:201},(_,i)=>String(1100+i));
 save('universe.json',ids.map(id=>({id,name:'示意'+id,sector:'半導體業',market:'上市'})));
 save('groups.json',{version:1,groups:[{id:'test',name:'示意研究',stockIds:ids}],stockMetadata:[]});
 const daily={date:'2026-10-21',scope:'market',total:{count:1952},sectors:[]};save('heatmap-2026-10-21.json',daily);
 const child=spawn(process.execPath,['--import','./tests/helpers/heat-stream-offline.mjs','server.mjs'],{cwd:root,env:{...process.env,PORT:'4395',EQUITY_DATA_DIR:dir,DEMO_TIME:'2026-10-22T10:00:00+08:00',SHIOAJI_BRIDGE_TOKEN:'offline-test',FINMIND_API_TOKEN:'',FUGLE_API_KEY:''},stdio:['ignore','pipe','pipe']});
 let log='';child.stderr.on('data',x=>log+=x);
 try{
 await Promise.race([once(child.stdout,'data'),new Promise((_,reject)=>setTimeout(()=>reject(Error(log||'startup timeout')),8000).unref())]);
 const get=async p=>{const r=await fetch('http://127.0.0.1:4395/api/'+p);assert.equal(r.status,200);return r.json();};
 let r;for(let i=0;i<40;i++){r=await get('heatmap/live');if(r.feed.status==='live')break;await new Promise(r=>setTimeout(r,200));}
 assert.equal(r.feed.status,'live');assert.equal(r.feed.symbols,200);assert.equal(r.data.total.count,200);assert.equal(r.data.total.money,44000000);assert.equal(r.data.scope,'research');assert.equal(r.data.sources[0].title,'Shioaji');
 const currentBoard=await get('board?ids=1100,1101,1300');
 assert.equal(currentBoard.provider,'shioaji');assert.equal(currentBoard.live,true);assert.equal(currentBoard.feed.subscribed,200);
 assert.equal(currentBoard.stocks[0].quote?.close,110,'board uses existing push without snapshots');assert.equal(currentBoard.stocks[0].quote?.source,'stream');
 assert.equal(currentBoard.stocks[0].quote?.date,'2026-10-22');assert.equal(currentBoard.stocks[2].quote,null);assert.equal(currentBoard.stocks[2].status,'not-subscribed');
 const inject=(time,close,timestamp=Date.parse(time.replace(' ','T')+'+08:00'))=>save('inject-quote.json',{event:'data',channel:'aggregates',data:{symbol:'1100',time,ts:timestamp,close,change:10,totalAmount:close*2000,totalVolume:2}});
 inject('2026-10-22 13:30:00',999);await new Promise(r=>setTimeout(r,1200));
 assert.equal((await get('board?ids=1100')).stocks[0].quote?.close,110,'future events cannot reach the board or daytrade engine');
 inject('2026-10-22 10:00:00',999,Date.parse('2026-10-22T13:30:00+08:00'));await new Promise(r=>setTimeout(r,1200));
 assert.equal((await get('board?ids=1100')).stocks[0].quote?.close,110,'future event timestamps are also rejected before ingestion');
 inject('2026-10-22 10:00:01',120);await new Promise(r=>setTimeout(r,1200));
 assert.equal((await get('board?ids=1100')).stocks[0].quote?.close,120,'normal events remain accepted after invalid future input');
 const transport=()=>fs.readFileSync(path.join(dir,'transport.ndjson'),'utf8');const before=transport();
 for(let i=0;i<5;i++)await get('heatmap/live');assert.equal(transport(),before,'reading heatmap adds no subscriptions');
 assert.equal(before.split('\n').filter(x=>x.includes('subscribe')).length,4,'existing 200-stock plan batches by 50');
 fs.writeFileSync(path.join(dir,'disconnect'),'');await new Promise(r=>setTimeout(r,700));r=await get('heatmap/live');assert.equal(r.feed.status,'disconnected');assert.equal(r.data,null);
 const downBoard=await get('board?ids=1100');assert.equal(downBoard.live,false);assert.equal(downBoard.feed.status,'disconnected');assert.equal(downBoard.stocks[0].quote,null);assert.deepEqual(downBoard.stocks[0].spark,[]);
 fs.writeFileSync(path.join(dir,'no-quotes'),'');fs.unlinkSync(path.join(dir,'disconnect'));
 for(let i=0;i<35;i++){r=await get('heatmap/live');if(r.feed.status==='waiting')break;await new Promise(r=>setTimeout(r,200));}
 assert.equal(r.feed.status,'waiting','reconnect waits for a new quote instead of reviving previous-session cache');assert.equal(r.data,null);
 const resumedBoard=await get('board?ids=1100');assert.equal(resumedBoard.feed.status,'waiting');assert.equal(resumedBoard.stocks[0].quote,null);
 assert.deepEqual((await get('heatmap?date=2026-10-21')).data,daily);assert.equal(fs.existsSync(path.join(dir,'heatmap-2026-10-22.json')),false);
 assert.equal((await fetch('http://127.0.0.1:4395/heat-feed.js')).status,200);
 }finally{child.kill();await once(child,'exit');fs.rmSync(dir,{recursive:true,force:true});}
});
