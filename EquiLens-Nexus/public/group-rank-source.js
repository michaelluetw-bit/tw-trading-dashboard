import { boardFeedNotice, quoteProviderName } from './quote-source.js';
const esc = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const canCompareGroupRank = d => !!(d?.scopeKey && d?.coverageKey && d?.comparison?.compatible);
const reasons = {'no-previous':'尚無前一交易日收盤紀錄','unknown-scope':'舊紀錄未記錄成分範圍，無法確認同範圍','scope-changed':'族群成分範圍不同','coverage-changed':'有效報價涵蓋不同','rules-changed':'排名規則不同',unavailable:'目前無有效即時排名'};
export function groupRankNotice(d) {
  if(!d)return '';
  const c=d.comparison,compare=canCompareGroupRank(d),previous=c?.previousDate||d.compare?.date;
  const source=d.feed?boardFeedNotice(d.feed):`<div class="notice" role="status"><span>${d.provider?esc(quoteProviderName(d.provider)):'收盤紀錄（來源未記錄）'} · 行情時間 ${esc(d.asOf||'—')}</span></div>`;
  const before=previous?` · 對照 ${esc(previous)}${c?.previousQuoted!=null?` 涵蓋 ${esc(c.previousQuoted)} / ${esc(c.previousStocks)} 檔`:''}`:'';
  return `<div data-rank-source>${source}</div><div class="notice ${compare?'':'warn'}" data-rank-coverage role="status"><span>本筆涵蓋 ${esc(d.quoted)} / ${esc(d.stocks)} 檔${before} · ${compare?'同範圍，可比較名次':`${esc(reasons[c?.reason]||reasons['unknown-scope'])}；不顯示升降名次`}</span></div>`;
}
export function groupRankFailed(d,status='error',date=d?.date) {
  if(!d||d.source!=='live')return null;
  return {...d,date,asOf:null,quoted:0,comparison:{...d.comparison,compatible:false,reason:'unavailable'},feed:{provider:d.provider,...d.feed,status,quoted:0,asOf:null},
    groups:d.groups.map(g=>({...g,quoted:0,used:0,excluded:0,rank:null,score:null,wavg:null,avg:null,median:null,up:0,down:0,flat:0,breadth:null,amount:0,share:null,top:null,items:[],prevRank:null,move:null}))};
}
export function currentGroupRank(d,today) {
  if(d?.provider!=='shioaji'||d.source!=='live')return d;
  if(d.date!==today)return groupRankFailed(d,'waiting',today);
  return ['live','partial'].includes(d.feed?.status)?d:groupRankFailed(d,d.feed?.status||'error');
}
export function createGroupRankLoader({request,receive,fail,today,timeoutMs=10000}) {
  let pending=null;
  return function load(){
    if(pending)return pending;
    pending=(async()=>{
      let timer;
      try{const result=await Promise.race([Promise.resolve().then(request),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('排名連線逾時，等待恢復')),timeoutMs);})]);receive(currentGroupRank(result,today()));}
      catch(e){fail(e);}
      finally{clearTimeout(timer);pending=null;}
    })();
    return pending;
  };
}
