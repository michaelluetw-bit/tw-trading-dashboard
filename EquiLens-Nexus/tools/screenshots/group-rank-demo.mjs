// Augment the existing synthetic demo. Never run against production data.
import fs from 'node:fs';
import path from 'node:path';
const dir=process.env.EQUITY_DATA_DIR;
if(!dir||!fs.existsSync(path.join(dir,'demo-meta.json')))throw Error('先在獨立目錄產生 demo-data 與 demo-data2');
const {buildGroupRanking,RANK_RULES}=await import('../../lib/grouprank.mjs');
const read=f=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));
const save=(f,value)=>fs.writeFileSync(path.join(dir,f),JSON.stringify(value));
const universe=read('universe.json'),groups=read('groups.json').groups,fixtures={};
for(const [i,s] of universe.entries()){
 const file=path.join(dir,'stocks',s.id+'.json'),bars=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')).price:[];
 const previous=bars?.at(-1)?.close||s.base||100,rate=[2.5,-1.8,0.75,-0.5,3][i%5],close=Math.round(previous*(1+rate/100)*100)/100;
 fixtures[s.id]={close,change:Math.round((close-previous)*100)/100,totalAmount:20000000*(1+i%8),totalVolume:1000+i*35};
}
save('rank-fixtures.json',fixtures);
save('config.json',{version:1,setupDone:true,market:'TW',language:'zh-TW',providers:{enabled:['shioaji','finmind'],prefer:{stream:'shioaji'}},remote:{tunnel:'off'}});
save('settings.json',{...read('settings.json'),autoUpdate:false,monitor:true,daytrade:{enabled:false},news:{enabled:false,cnyes:false}});
const ids=[...new Set(groups.flatMap(g=>g.stockIds))],quotes=new Map();
for(const id of ids.slice(7)){
 const x=fixtures[id];quotes.set(id,{name:universe.find(s=>s.id===id)?.name||id,close:x.close,rate:x.change/(x.close-x.change)*100,amount:x.totalAmount,time:'2026-10-21 13:30:00'});
}
save('grouprank-2026-10-21.json',{date:'2026-10-21',source:'close',asOf:'2026-10-21 13:30:00',stocks:ids.length,quoted:quotes.size,rules:RANK_RULES,compare:{date:'2026-10-20'},groups:buildGroupRanking(groups,quotes).map(g=>({...g,prevRank:g.rank+3,move:3}))});
console.log(`Synthetic group rank: ${ids.length} current stocks; ${quotes.size} in legacy history`);
