import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const root=new URL('../',import.meta.url);
test('Shioaji HTTP heatmap reuses subscriptions, reports disconnect and preserves daily history',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'heat-stream-'));
 const save=(name,data)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(data));
 save('config.json',{version:1,market:'TW',setupDone:true,providers:{enabled:['shioaji'],prefer:{stream:'shioaji'}}});
 save('settings.json',{autoUpdate:false,monitor:true,daytrade:{enabled:false}});
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
 const transport=()=>fs.readFileSync(path.join(dir,'transport.ndjson'),'utf8');const before=transport();
 for(let i=0;i<5;i++)await get('heatmap/live');assert.equal(transport(),before,'reading heatmap adds no subscriptions');
 assert.equal(before.split('\n').filter(x=>x.includes('subscribe')).length,4,'existing 200-stock plan batches by 50');
 fs.writeFileSync(path.join(dir,'disconnect'),'');await new Promise(r=>setTimeout(r,700));r=await get('heatmap/live');assert.equal(r.feed.status,'disconnected');assert.equal(r.data,null);
 fs.writeFileSync(path.join(dir,'no-quotes'),'');fs.unlinkSync(path.join(dir,'disconnect'));
 for(let i=0;i<35;i++){r=await get('heatmap/live');if(r.feed.status==='waiting')break;await new Promise(r=>setTimeout(r,200));}
 assert.equal(r.feed.status,'waiting','reconnect waits for a new quote instead of reviving previous-session cache');assert.equal(r.data,null);
 assert.deepEqual((await get('heatmap?date=2026-10-21')).data,daily);assert.equal(fs.existsSync(path.join(dir,'heatmap-2026-10-22.json')),false);
 assert.equal((await fetch('http://127.0.0.1:4395/heat-feed.js')).status,200);
 }finally{child.kill();await once(child,'exit');fs.rmSync(dir,{recursive:true,force:true});}
});
