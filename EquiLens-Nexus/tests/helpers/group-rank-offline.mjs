// Test-only: all sockets and external requests are isolated from the broker.
import './heat-stream-offline.mjs';
import fs from 'node:fs';
import path from 'node:path';
const deliver=globalThis.WebSocket.prototype.message;
globalThis.WebSocket.prototype.message=function(message){
 const file=path.join(process.env.EQUITY_DATA_DIR,'rank-fixtures.json');
 if(message.event==='data'&&fs.existsSync(file)){
  const quote=JSON.parse(fs.readFileSync(file,'utf8'))[message.data.symbol];
  if(quote)message={...message,data:{...message.data,...quote}};
 }
 return deliver.call(this,message);
};
const localFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
 const address=new URL(String(url?.url||url));
 if(['127.0.0.1','localhost'].includes(address.hostname))return localFetch(url,options);
 fs.appendFileSync(path.join(process.env.EQUITY_DATA_DIR,'external.ndjson'),JSON.stringify({host:address.hostname,path:address.pathname})+'\n');
 return new Response(JSON.stringify({status:400,msg:'Your level is register, Sponsor required',data:[]}),{status:400,headers:{'content-type':'application/json'}});
};
