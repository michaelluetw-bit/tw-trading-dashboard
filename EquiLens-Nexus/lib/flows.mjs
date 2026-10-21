import {buildOptions} from './options.mjs';
import {request} from './finmind.mjs';
import {todayTW,minusDays,round} from './engine.mjs';
import {t} from './i18n.mjs';
export const FLOW_VERSION='2.0';
export function cacheableFlow(result){return !Object.keys(result.errors).length&&result.options?.available&&result.options.contracts.length>0&&result.summary.available&&result.futures.available&&result.coverage.withRecords>0&&result.rankings.every(r=>r.covered>0);}
export function validFlowDate(date,latest=todayTW()){return typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date&&date>='2018-06-05'&&date<=latest;}
const amount=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
function net(r){const buy=amount(r?.buy),sell=amount(r?.sell);return buy===null||sell===null?null:buy-sell;}
function sum(values){return values.every(v=>v!==null)?values.reduce((a,b)=>a+b,0):null;}
export function flowNames(rows){const m=new Map(rows.map(r=>[r.name,r]));return {foreign:m.has('Foreign_Investor')?sum([net(m.get('Foreign_Investor')),m.has('Foreign_Dealer_Self')?net(m.get('Foreign_Dealer_Self')):0]):null,trust:net(m.get('Investment_Trust')),dealer:m.has('Dealer')?net(m.get('Dealer')):sum([net(m.get('Dealer_self')),net(m.get('Dealer_Hedging'))])};}
export function flowCatalog(info){const catalog=new Map();for(const r of info){if(!/^[1-9]\d{3}$/.test(r.stock_id)||!['twse','tpex'].includes(r.type)||/ETF|ETN|存託|受益|權證|牛熊/.test(r.industry_category||''))continue;const prev=catalog.get(r.stock_id);if(!prev||String(r.date||'')>String(prev.date||''))catalog.set(r.stock_id,{id:r.stock_id,name:r.stock_name,market:r.type==='twse'?'上市':'上櫃',date:r.date});}return catalog;}
export function buildFlows(date,{info=[],stocks=[],total=[],futures=[],options=[],optionDaily=[]},errors={}){
 const catalog=flowCatalog(info),byStock=new Map();for(const r of stocks){if(r.date!==date||!catalog.has(r.stock_id))continue;if(!byStock.has(r.stock_id))byStock.set(r.stock_id,[]);byStock.get(r.stock_id).push(r);}
 const rows=[...byStock].map(([id,items])=>{const n=flowNames(items);return {...catalog.get(id),...n,total:sum(Object.values(n))};});
 const rankings=['上市','上櫃'].flatMap(market=>['foreign','trust','dealer','total'].map(investor=>{const eligible=rows.filter(r=>r.market===market&&r[investor]!==null),sort=(a,b)=>b[investor]-a[investor]||a.id.localeCompare(b.id),map=r=>({id:r.id,name:r.name,netShares:r[investor],netLots:round(r[investor]/1000,3)});return {id:(market==='上市'?'twse':'tpex')+'-'+investor,market,investor,title:market+({foreign:'外資',trust:'投信',dealer:'自營商',total:'三大法人合計'}[investor])+'買賣超前 20',covered:eligible.length,buy:eligible.filter(r=>r[investor]>0).sort(sort).slice(0,20).map(map),sell:eligible.filter(r=>r[investor]<0).sort((a,b)=>sort(b,a)).slice(0,20).map(map)};}));
 const totals=total.filter(r=>r.date===date),summary=flowNames(totals),sourceTotal=totals.find(r=>r.name==='total');summary.total=sourceTotal?net(sourceTotal):sum(Object.values(summary));
 const tx=[...new Map(futures.filter(r=>(r.futures_id||r.name)==='TX'&&r.institutional_investors==='外資'&&r.date<=date).map(r=>[r.date,r])).values()].sort((a,b)=>a.date.localeCompare(b.date)),current=tx.find(r=>r.date===date),previous=tx.filter(r=>r.date<date).at(-1);
 const position=r=>{const long=amount(r?.long_open_interest_balance_volume),short=amount(r?.short_open_interest_balance_volume);return long===null||short===null?null:{long,short,net:long-short};},now=position(current),before=position(previous);
 return {version:FLOW_VERSION,date,retrievedAt:new Date().toISOString(),summary:{available:totals.length>0,...summary},futures:{available:!!now,asOf:now?date:null,previousDate:before?previous.date:null,...now,netChange:now&&before?now.net-before.net:null,longChange:now&&before?now.long-before.long:null,shortChange:now&&before?now.short-before.short:null},options:buildOptions(date,options,optionDaily),rankings,errors,coverage:{indexed:catalog.size,withRecords:rows.length,returnedRecords:stocks.filter(r=>r.date===date).length},sources:[{title:'期交所選擇權買賣權分計',url:'https://www.taifex.com.tw/cht/3/callsAndPutsDate'},{title:'FinMind 現貨籌碼資料',url:'https://finmind.github.io/tutor/TaiwanMarket/Chip/'},{title:'FinMind 期貨法人資料',url:'https://finmind.github.io/tutor/TaiwanMarket/Derivative/'}]};
}
// 全市場個股法人備援（證交所 T86＋櫃買中心）：FinMind 沒有資料時使用；必須兩個市場都通過日期、格式與覆蓋率檢查才採用
export const FALLBACK_MIN_COVERAGE=0.6;
const INVESTORS=new Set(['Foreign_Investor','Foreign_Dealer_Self','Investment_Trust','Dealer_self','Dealer_Hedging']);
const FALLBACK_SOURCES=[{title:'證交所三大法人買賣超日報（T86）',url:'https://www.twse.com.tw/zh/trading/foreign/t86.html'},{title:'櫃買中心三大法人買賣明細',url:'https://www.tpex.org.tw/zh-tw/mainboard/trading/major-institutional/detail/day.html'}];
// 範圍外的證券（ETF、權證等，不在 flowCatalog）略過不檢查；覆蓋率＝同市場、索引內、不重複代號數 ÷ 索引中該市場檔數（60% 只是異常警戒線）
export function checkFallbackStocks(date,result,catalog){
 const markets=result?.markets||{},rows=Array.isArray(result?.rows)?result.rows:[];
 const inScope=rows.filter(r=>catalog.has(String(r?.stock_id)));
 const badRows=inScope.filter(r=>!INVESTORS.has(r.name)||!Number.isFinite(r.buy)||!Number.isFinite(r.sell)||r.date!==date).length;
 // 格式不符的原始列（provider 附代號）：只看股票索引範圍內的股票
 const invalidIds=[...new Set((Array.isArray(result?.invalid)?result.invalid:[]).map(x=>String(x?.stock_id)).filter(id=>catalog.has(id)))];
 // 每檔 5 種法人分類必須各有且只有一列
 const byStock=new Map();for(const r of inScope){const id=String(r.stock_id);if(!byStock.has(id))byStock.set(id,new Map());const m=byStock.get(id);m.set(r.name,(m.get(r.name)||0)+1);}
 const incomplete=[...byStock].filter(([,m])=>m.size!==INVESTORS.size||[...INVESTORS].some(n=>m.get(n)!==1)).map(([id])=>id);
 const bad=new Set([...invalidIds,...incomplete]),complete=id=>byStock.has(id)&&!bad.has(id);
 const empty=!rows.length&&!invalidIds.length&&['twse','tpex'].every(k=>!markets[k]?.error);
 const coverage={},problems=[];
 for(const [key,market] of [['twse','上市'],['tpex','上櫃']]){
  const m=markets[key]||{},indexed=[...catalog.values()].filter(c=>c.market===market).length;
  const covered=[...byStock.keys()].filter(id=>catalog.get(id).market===market&&complete(id)).length;
  coverage[key]={covered,indexed,ratio:indexed?round(covered/indexed,3):null};
  const label=t(market);
  if(m.error)problems.push(t('{market}：{error}',{market:label,error:m.error}));
  else if(m.date!==date)problems.push(t('{market}：回傳日期 {date}',{market:label,date:m.date||t('無')}));
  else if(!indexed)problems.push(t('{market}：股票索引沒有此市場',{market:label}));
  else if(covered/indexed<FALLBACK_MIN_COVERAGE)problems.push(t('{market}：筆數異常偏低（{covered}／{indexed} 檔）',{market:label,covered,indexed}));
 }
 const list=ids=>ids.slice(0,5).join('、')+(ids.length>5?'…':'');
 if(invalidIds.length)problems.push(t('格式錯誤 {count} 檔（{ids}）',{count:invalidIds.length,ids:list(invalidIds)}));
 if(incomplete.length)problems.push(t('法人分類不完整 {count} 檔（{ids}）',{count:incomplete.length,ids:list(incomplete)}));
 if(badRows)problems.push(t('格式錯誤 {count} 列',{count:badRows}));
 return {ok:!problems.length,empty,problems,coverage,rows:inScope.filter(r=>complete(String(r.stock_id)))};
}
export async function queryFlows(date,{requestData=request,fallbackStocks=null,...options}={}){
 if(!validFlowDate(date))throw new Error('請選擇 2018-06-05 至今天的有效日期');
 const data={},errors={},tasks=[['info','TaiwanStockInfo',{}],['stocks','TaiwanStockInstitutionalInvestorsBuySell',{start_date:date,end_date:date}],['total','TaiwanStockTotalInstitutionalInvestors',{start_date:date,end_date:date}],['futures','TaiwanFuturesInstitutionalInvestors',{data_id:'TX',start_date:minusDays(date,60),end_date:date}],['options','TaiwanOptionInstitutionalInvestors',{data_id:'TXO',start_date:minusDays(date,14),end_date:date}],['optionDaily','TaiwanOptionDaily',{data_id:'TXO',start_date:minusDays(date,7),end_date:date}]];
 let stopped=false;for(const [key,dataset,params] of tasks){if(stopped){errors[key]='前項遇到額度或認證限制，未繼續查詢';continue;}try{data[key]=await requestData(dataset,params,options);}catch(e){errors[key]=e.message;if(e.fatal)stopped=true;}}
 let fallback=null;
 if(fallbackStocks&&!errors.info&&(errors.stocks||!(data.stocks||[]).some(r=>r.date===date))){
  const reason=errors.stocks||t('FinMind 沒有此日的個股法人資料');
  try{
   const check=checkFallbackStocks(date,await fallbackStocks(date),flowCatalog(data.info||[]));
   if(check.ok){data.stocks=check.rows;delete errors.stocks;fallback=check.coverage;}
   else errors.stocks=check.empty?t('{reason}；證交所／櫃買中心沒有 {date} 的資料（非交易日或尚未公布）',{reason,date}):t('{reason}；證交所／櫃買備援未採用：{problems}',{reason,problems:check.problems.join(t('、'))});
  }catch(e){errors.stocks=t('{reason}；證交所／櫃買備援失敗：{error}',{reason,error:e.message});}
 }
 const result=buildFlows(date,data,errors);
 return fallback?{...result,stocksSource:'twse',fallbackCoverage:fallback,sources:[...result.sources,...FALLBACK_SOURCES]}:result;
}
