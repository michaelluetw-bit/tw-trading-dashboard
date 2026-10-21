// Synthetic examples only. No user data, accounts or remote requests.
import fs from 'node:fs';
import path from 'node:path';
const dir=process.env.EQUITY_DATA_DIR;if(!dir)throw Error('EQUITY_DATA_DIR required');
const save=(name,value)=>{const file=path.join(dir,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));};
const days=[];for(let d=new Date('2026-03-01');d<=new Date('2026-10-16');d.setUTCDate(d.getUTCDate()+1))if(d.getUTCDay()>0&&d.getUTCDay()<6)days.push(d.toISOString().slice(0,10));
const universe=[{id:'9991',name:'興櫃示意公司',market:'上市',sector:'示意資料'},{id:'9992',name:'轉換示意控股',market:'上櫃',sector:'示意資料'}];
save('config.json',{version:1,setupDone:true,market:'TW',language:'zh-TW',providers:{enabled:['twse'],prefer:{}}});save('settings.json',{autoUpdate:false,monitor:false,news:{enabled:false},report:{enabled:false}});save('universe.json',universe);save('groups.json',{version:1,groups:[{id:'demo-history',name:'補充行情示意',stockIds:['9991','9992']}],stockMetadata:universe});
for(const stock of universe){
 const all=days.map((date,i)=>{const close=Math.round((45+i*.2+Math.sin(i/8)*5)*100)/100;return {date,stock_id:stock.id,open:close-.4,max:close+1,min:close-1,close,Trading_Volume:100000+i*100,Trading_money:Math.round(close*(100000+i*100))};});
 const split=stock.id==='9991'?70:100,gap=stock.id==='9991'?1:8;const price=all.slice(split+gap);save(`stocks/${stock.id}.json`,{price,adjusted:price,adjustedIsRaw:true});
 save(`history-supplements/TW/${stock.id}.json`,{version:1,market:'TW',stockId:stock.id,from:days[0],to:days.at(-1),checkedAt:'2026-10-16',calendar:days,segments:[{kind:stock.id==='9991'?'emerging':'predecessor',market:stock.id==='9991'?'興櫃':'上櫃',originalId:stock.id==='9991'?stock.id:'9990',rows:all.slice(0,split).map(r=>({date:r.date,open:stock.id==='9991'?null:r.open,previousAverage:stock.id==='9991'?r.close+5:null,dailyAverage:stock.id==='9991'?r.close-.1:null,high:r.max,low:r.min,close:r.close,volume:r.Trading_Volume,amount:r.Trading_money,sources:['https://example.com/demo']}))}],gaps:days.slice(split,split+gap).map(date=>({date,kind:stock.id==='9991'?'示意無報價':'示意股份轉換停牌',reason:stock.id==='9991'?'示意：當日無有效成交報價':'示意：股份轉換停止買賣',sources:['https://example.com/demo']})),notes:['全部為合成示意資料，不代表實際公司行情。']});
}
