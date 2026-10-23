// Local integration fixture: synthetic RSS only, no real credentials or external sockets.
import fs from 'node:fs';import path from 'node:path';
const root=process.env.EQUITY_DATA_DIR,read=(name,fallback)=>{try{return JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));}catch{return fallback;}};
const Clock=Date,start=Date.parse('2026-10-23T02:00:00Z');
globalThis.Date=class extends Clock{constructor(...args){super(...(args.length?args:[start+read('advance.json',0)]));}static now(){return start+read('advance.json',0);}};
const interval=globalThis.setInterval;globalThis.setInterval=(fn,ms,...args)=>interval(fn,ms===5000?20:ms,...args);
const localFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
 const u=new URL(String(url?.url||url));if(['localhost','127.0.0.1'].includes(u.hostname))return localFetch(url,options);
 const id=u.hostname==='technews.tw'?'technews':u.hostname==='news.ltn.com.tw'?'ltn':u.hostname==='api.cnyes.com'?'cnyes':'unexpected';
 fs.appendFileSync(path.join(root,'requests.ndjson'),JSON.stringify({id,at:Date.now(),path:u.pathname})+'\n');
 if(id==='unexpected')throw Error('unexpected external fixture request');
 if(id==='cnyes'){const titles=read('feed-cnyes.json',{}).titles||[];return Response.json({items:{data:titles.map((title,i)=>({newsId:i+1,title,stock:['2330'],publishAt:start/1000}))}});}
 while(fs.existsSync(path.join(root,'hold-'+id)))await new Promise(r=>setTimeout(r,10));
 const config=read('feed-'+id+'.json',{});if(config.fail)return new Response('fixture unavailable',{status:503});
 const titles=config.titles||['台積電合成既有新聞'];const domain=id==='technews'?'technews.tw':'ec.ltn.com.tw';
 return new Response(`<rss version="2.0"><channel><title>合成</title>${titles.map((title,i)=>`<item><title>${title}</title><link>https://${domain}/synthetic/${encodeURIComponent(title)}</link><pubDate>Fri, 23 Oct 2026 01:00:00 GMT</pubDate><description>合成測試，沒有真文章。</description></item>`).join('')}</channel></rss>`);
};
