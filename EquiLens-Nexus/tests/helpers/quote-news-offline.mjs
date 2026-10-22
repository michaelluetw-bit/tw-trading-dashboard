// Offline integration fixture: no real credentials, broker or external HTTP.
import './group-rank-offline.mjs';
import fs from 'node:fs';
import path from 'node:path';
const file=name=>path.join(process.env.EQUITY_DATA_DIR,name),read=name=>fs.existsSync(file(name))?JSON.parse(fs.readFileSync(file(name),'utf8')):null;
const Clock=Date;
globalThis.Date=class extends Clock {
 constructor(...args){super(...(args.length?args:[Clock.now()+(read('advance-ms.json')||0)]));}
 static now(){return Clock.now()+(read('advance-ms.json')||0);}
};
const request=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
 const u=new URL(String(url?.url||url));
 if(['localhost','127.0.0.1'].includes(u.hostname))return request(url,options);
 fs.appendFileSync(file('external.ndjson'),JSON.stringify({host:u.hostname,path:u.pathname,dataset:u.searchParams.get('dataset')})+'\n');
 if(u.pathname.endsWith('/taiwan_stock_tick_snapshot')&&read('snapshot-fixture.json'))return Response.json({status:200,data:read('snapshot-fixture.json')});
 if(u.searchParams.get('dataset')==='TaiwanStockTradingDate')return Response.json({status:200,data:['2026-10-20','2026-10-21','2026-10-22'].map(date=>({date}))});
 if(u.searchParams.get('dataset')==='TaiwanStockNews'&&fs.existsSync(file('hold-news'))){
  fs.writeFileSync(file('news-request-started'),'');
  while(!fs.existsSync(file('release-news')))await new Promise(r=>setTimeout(r,25));
 }
 if(u.hostname==='api.cnyes.com'){
  const n=read('cnyes-fixture.json')||{id:1};
  if(n.fail)return Response.json({msg:'fixture unavailable'},{status:503});
  return Response.json({items:{data:[{newsId:n.id,title:'示意新聞 '+n.id,stock:[n.stock||'1100'],publishAt:Date.parse('2026-10-22T09:59:00+08:00')/1000}]}});
 }
 return Response.json({status:400,msg:'Your level is register, Sponsor required',data:[]},{status:400});
};
