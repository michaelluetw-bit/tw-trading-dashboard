// Test-only quote transport: no socket, broker key, order or external HTTP call.
import fs from 'node:fs';
import path from 'node:path';
import '../../tools/screenshots/clock.mjs';
const RealSocket = EventTarget;
globalThis.WebSocket = class extends RealSocket {
  constructor(){super();this.closed=false;setTimeout(()=>this.dispatchEvent(new Event('open')),5);}
  message(data){if(!this.closed)this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(data)}));}
  send(raw){const m=JSON.parse(raw);if(!['auth','subscribe'].includes(m.event))throw Error('unexpected operation');
    fs.appendFileSync(path.join(process.env.EQUITY_DATA_DIR,'transport.ndjson'),JSON.stringify({event:m.event,symbols:m.data?.symbols})+'\n');
    if(m.event==='auth')setTimeout(()=>this.message({event:'authenticated'}),5);
    if(m.event==='subscribe')setTimeout(()=>{
      this.message({event:'subscribed',data:m.data.symbols.map(symbol=>({symbol,channel:'aggregates'}))});
      if(!fs.existsSync(path.join(process.env.EQUITY_DATA_DIR,'no-quotes')))for(const symbol of m.data.symbols)this.message({event:'data',channel:'aggregates',data:{symbol,time:'2026-10-22 09:59:30',ts:Date.now(),close:110,change:10,totalAmount:220000,totalVolume:2}});
      if(!this.timer)this.timer=setInterval(()=>{if(fs.existsSync(path.join(process.env.EQUITY_DATA_DIR,'disconnect')))this.close();else this.message({event:'heartbeat'});},500);
    },10);
  }
  close(){if(this.closed)return;this.closed=true;clearInterval(this.timer);this.dispatchEvent(new Event('close'));}
};
