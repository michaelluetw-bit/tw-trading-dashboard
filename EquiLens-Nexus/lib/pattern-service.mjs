import { trustedAdjusted } from './adjusted-data.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { LOCAL, read, write, readStocks } from './storage.mjs';
import { data } from './providers/index.mjs';
import { permitted, screenPatterns } from './patterns.mjs';
import { marketToday as todayTW } from './engine.mjs';
import { UserError, t } from './i18n.mjs';
let cache;
function activeInfo(){return read('pattern-active.json',null);}
function patternRaw(ids){const active=activeInfo(),base=readStocks(ids);for(const id of ids)base[id]=read(`${active?.directory||'pattern-stocks'}/${id}.json`,base[id]||{});return base;}
export function clearPatterns(){cache=null;}
export function patternSnapshot(universe){
  const cutoff=todayTW(),key=JSON.stringify(universe);
  if(!cache||cache.cutoff!==cutoff||cache.key!==key){const active=activeInfo();cache={key,cutoff,value:screenPatterns(universe,patternRaw(universe.filter(permitted).map(x=>x.id)),cutoff,active?.calendar||read('pattern-calendar.json',[]))};cache.value.snapshotCompletedAt=active?.completedAt||null;}
  return cache.value;
}
// 型態更新需要原始及真正還原的全市場日線（FinMind Backer）；options.request供離線測試注入。
export async function updatePatternData(universe,options){
  const fetcher=options.request||null,cutoff=options.cutoff||todayTW();
  if(!fetcher&&!data.pick('dailyAll')?.dailyAllAdjusted)throw new UserError('缺可信還原股價，技術分項不可用');
  const calendar=fetcher?(await fetcher('TaiwanStockTradingDate',{},options)).map(x=>x.date):await data.calendar(null,options),dates=[...new Set(calendar.filter(d=>d<=cutoff))].sort().slice(-90);
  if(dates.length!==90)throw new UserError('股票交易日曆不足 90 日，保留原資料');
  const ids=universe.filter(permitted).map(x=>x.id).sort(),known=new Set(ids),raw=patternRaw(ids);
  const signature=crypto.createHash('sha256').update(JSON.stringify(ids)).digest('hex').slice(0,12);
  const directory=`pattern-snapshots/verified-v1-${cutoff}-${signature}`;
  fs.mkdirSync(path.join(LOCAL,directory),{recursive:true});
  const hasMissing=ids.some(id=>!raw[id]?.price?.length||!trustedAdjusted(raw[id]));
  const previousLedger=activeInfo()?.directory ? read(activeInfo().directory+'/ledger.json',{}) : read('pattern-ledger.json',read('bulk-ledger.json',{}));
  const ledger=read(`${directory}/ledger.json`,!hasMissing&&activeInfo()?.directory?.includes('/verified-v1-')?previousLedger:{}); // never promote a legacy ledger into verified provenance
  for(const id of ids)raw[id]=read(`${directory}/${id}.json`,raw[id]||{});
  const tasks=[];
  for(const key of ['price','adjusted'])for(const date of dates){const dataset=key==='price'?'TaiwanStockPrice':'TaiwanStockPriceAdj',stamp=key==='price'?date:cutoff,token=`${dataset}:${date}`;if(ledger[token]!==stamp)tasks.push({key,date,dataset,stamp,token});}
  let done=0,empty=0;const dirty=new Set(ids);
  const flush=()=>{for(const id of dirty)write(`${directory}/${id}.json`,{price:raw[id].price,adjusted:raw[id].adjusted,adjustedSnapshot:raw[id].adjustedSnapshot,adjustedBatch:raw[id].adjustedBatch,adjustedProvenance:raw[id].adjustedProvenance,adjustedIsRaw:raw[id].adjustedIsRaw});dirty.clear();write(`${directory}/ledger.json`,ledger);};
  try{for(const task of tasks){
    if(options.signal?.aborted)break;
    options.onProgress?.({done,total:tasks.length,current:task.date,dataset:task.dataset,message:t('型態資料準備中 {done}/{total} 批次；仍顯示上次完整快照',{done,total:tasks.length})});
    const rows=fetcher?await fetcher(task.dataset,{start_date:task.date,end_date:task.date},options):task.key==='price'?await data.dailyAll(task.date,options):await data.dailyAllAdjusted(task.date,options);
    for(const r of rows){if(!known.has(r.stock_id))continue;const id=r.stock_id;
      if(task.key==='adjusted'&&raw[id].adjustedBatch!==directory){raw[id].adjusted=[];raw[id].adjustedSnapshot=cutoff;raw[id].adjustedBatch=directory;delete raw[id].adjustedProvenance;delete raw[id].adjustedIsRaw;}
      const merged=new Map((raw[id][task.key]||[]).map(x=>[x.date,x]));merged.set(r.date,r);raw[id][task.key]=[...merged.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-300);dirty.add(id);
    }
    if(rows.length)ledger[task.token]=task.stamp;else empty++;
    done++;if(done%10===0)flush();
  }}finally{flush();options.onProgress?.({done,total:tasks.length});}
  const complete=done===tasks.length&&!empty&&!options.signal?.aborted;
  // One atomic pointer write publishes only a complete snapshot. Failed or
  // cancelled downloads remain resumable, without changing the visible data.
  if(complete){
    for(const id of ids){if(raw[id].adjustedBatch!==directory)continue;raw[id].adjustedProvenance={kind:'adjusted',provider:'finmind',dataset:'TaiwanStockPriceAdj',from:dates[0],to:cutoff,fetchedAt:new Date().toISOString()};dirty.add(id);}
    flush();
    write('pattern-active.json',{directory,calendar:dates,completedAt:new Date().toISOString()});clearPatterns();}
  return {done,total:tasks.length,complete,empty};
}
