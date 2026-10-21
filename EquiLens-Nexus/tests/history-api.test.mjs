import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('stock detail loads separate history, keeps standard prices, and isolates market and private files',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'history-api-')),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 const port=await new Promise(resolve=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const save=(f,v)=>{const p=path.join(dir,f);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v));};
 save('config.json',{version:1,setupDone:true,market:'TW',language:'zh-TW',providers:{enabled:[],prefer:{}}});save('settings.json',{autoUpdate:false,news:{enabled:false}});save('universe.json',[{id:'2330',name:'Demo',market:'上市',sector:''}]);save('groups.json',{version:1,groups:[{id:'demo',name:'Demo',stockIds:['2330']}],stockMetadata:[]});
 const bar={date:'2026-01-05',stock_id:'2330',open:10,max:12,min:9,close:11,Trading_Volume:1000,Trading_money:11000};save('stocks/2330.json',{price:[bar]});const original=fs.readFileSync(path.join(dir,'stocks/2330.json'),'utf8');
 const file='history-supplements/TW/2330.json';const supplement={version:1,market:'TW',stockId:'2330',from:'2026-01-02',to:'2026-01-05',calendar:['2026-01-02','2026-01-05'],segments:[{kind:'emerging',market:'興櫃',originalId:'2330',rows:[{date:'2026-01-02',previousAverage:99,high:9,low:7,close:8,volume:10,amount:80}]}],gaps:[],notes:[]};save(file,supplement);
 const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),EQUITY_DATA_DIR:dir,FINMIND_API_TOKEN:''},stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',c=>reject(Error('server '+c)));setTimeout(()=>reject(Error('startup timeout')),10000).unref();});
  const base=`http://127.0.0.1:${port}`;let d=await(await fetch(base+'/api/detail?id=2330')).json();assert.ok(d.history);assert.equal(d.history.points[0].open,null);assert.deepEqual(d.bars,[bar]);assert.equal(d.price,11);
  assert.equal((await fetch(base+'/.local/'+file)).status,404);assert.equal((await fetch(base+'/history-ui.js')).status,200);
  save(file,{...supplement,market:'US'});d=await(await fetch(base+'/api/detail?id=2330')).json();assert.ok(d.history.error);assert.equal(d.price,11);assert.equal(fs.readFileSync(path.join(dir,'stocks/2330.json'),'utf8'),original);
 }finally{await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');});fs.rmSync(dir,{recursive:true,force:true});}
});
