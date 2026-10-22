// Add synthetic OHLCV and news-source history to the existing isolated demo.
import fs from 'node:fs';
import path from 'node:path';
const dir=process.env.EQUITY_DATA_DIR;
if(!dir||!fs.existsSync(path.join(dir,'demo-meta.json')))throw Error('先建立獨立示意資料');
const read=name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
const save=(name,value)=>{fs.mkdirSync(path.dirname(path.join(dir,name)),{recursive:true});fs.writeFileSync(path.join(dir,name),JSON.stringify(value));};
const at=Date.parse('2026-10-22T09:58:00+08:00'),fixtures=read('rank-fixtures.json');
for(const [id,q] of Object.entries(fixtures)){
 const prev=q.close-q.change;q.open=prev;q.high=Math.max(prev,q.close)*1.01;q.low=Math.min(prev,q.close)*.99;
 if(!fs.existsSync(path.join(dir,'stocks',id+'.json')))continue;
 const rows=read('stocks/'+id+'.json').price.map(r=>[r.date,r.open,r.max,r.min,r.close,Math.round(r.Trading_Volume/1000)]);
 for(const d of ['2026-10-19','2026-10-20','2026-10-21'])rows.push([d,prev,prev*1.01,prev*.99,prev,1000]);
 save('daily/'+id+'.json',{at,rows});
}
save('rank-fixtures.json',fixtures);
save('settings.json',{...read('settings.json'),news:{enabled:true,scope:'all',quiet:false}});
const source={lastAttempt:at,lastSuccess:at,lastNew:at-5*60e3,error:'',pausedUntil:null};
save('news-seen.json',{at,seen:{},sources:['cnyes'],health:{finmind:{...source},cnyes:{...source}}});
save('cnyes-fixture.json',{id:2,stock:'2330'});
console.log('Synthetic quote/news demo ready');
