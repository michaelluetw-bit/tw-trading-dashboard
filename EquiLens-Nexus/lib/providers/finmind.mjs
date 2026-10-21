// FinMind（台股）：股票清單、交易日曆、日成交與還原股價、法人、月營收、本益比、個股新聞、股權分散、期貨與融資。
// Backer可用還原／全市場日線；Sponsor可用快照／分K。實際權限以finmind-access矩陣為準。
import { access, allows, confirmedPlan, responseCode } from '../finmind-access.mjs';
import { getSecret } from '../secrets.mjs';
import { normalizeUniverse } from '../engine.mjs';
import { kbarRows } from '../insight.mjs';
import { DataError, stopped, sleep, addDays } from './common.mjs';

export const DATASETS = { price: 'TaiwanStockPrice', adjusted: 'TaiwanStockPriceAdj', institutions: 'TaiwanStockInstitutionalInvestorsBuySell', revenue: 'TaiwanStockMonthRevenue', valuation: 'TaiwanStockPER' };
const tokenOf = t => t ?? getSecret('finmind', 'FINMIND_API_TOKEN');
let lastRequest = 0, requestTail = Promise.resolve();

// 所有 FinMind 請求共用一條佇列（含金鑰驗證），避免瞬間大量請求
export async function queued(action, {interval=7000,signal,validation=false,candidate=false}={}) {
  access.assert({validation,candidate});
  const previous=requestTail;let release;requestTail=new Promise(r=>release=r);
  await previous;
  try {
    access.assert({validation,candidate});
    const delay=Math.max(0,lastRequest+interval-Date.now());
    if(delay)await sleep(delay,signal);
    if(signal?.aborted)throw stopped();
    access.assert({validation,candidate});lastRequest=Date.now();return await action();
  } finally {release();}
}
export async function request(dataset, params = {}, options = {}) {
  return queued(async()=>{
    const cap=datasetCapability(dataset,params);
    if(!allows(confirmedPlan(access.state().entitlement),cap))throw new DataError('FinMind 資料權限尚未確認',null,{code:'plan'});
    const secret=await tokenOf(options.token);access.assert();
    if(!secret){access.fail('missing');throw new DataError('FinMind 憑證未啟用，已停止請求',null,{fatal:true,code:'auth'});}
    const path=dataset.startsWith('/'),url=new URL(`https://api.finmindtrade.com/api/v4${path?dataset:'/data'}`);
    url.search=new URLSearchParams(path?params:{dataset,...params}).toString();
    return fetchData(url,secret,options.signal,dataset,45000);
  },options);
}
export function datasetCapability(dataset,params={}) {
  if(dataset==='TaiwanStockPrice')return params.data_id?'daily':'dailyAll';
  if(dataset==='TaiwanStockPriceAdj')return params.data_id?'adjusted':'dailyAllAdjusted';
  if(dataset==='TaiwanStockInstitutionalInvestorsBuySell')return params.data_id?'institutional':'institutionalAll';
  if(dataset==='TaiwanStockNews')return params.data_id?'news':'marketNews';
  return ({TaiwanStockInfo:'universe',TaiwanStockDelisting:'universe',TaiwanStockTradingDate:'calendar',TaiwanStockMonthRevenue:'revenue',TaiwanStockPER:'valuation',TaiwanStockKBar:'intraday',TaiwanStockTotalInstitutionalInvestors:'flows',TaiwanFuturesInstitutionalInvestors:'futures',TaiwanFuturesDaily:'futures',TaiwanOptionInstitutionalInvestors:'futures',TaiwanOptionDaily:'futures',TaiwanStockTotalMarginPurchaseShortSale:'margin','/taiwan_stock_tick_snapshot':'snapshot'})[dataset];
}
async function fetchData(url, secret, signal, label, timeout) {
  access.assert();
  let response;
  try { response = await fetch(url, { headers: secret ? { Authorization: `Bearer ${secret}` } : {}, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout) }); }
  catch { if (signal?.aborted) throw stopped(); throw new DataError('FinMind 連線失敗或逾時'); }
  let body; try { body = await response.json(); } catch { const code=responseCode(response.status,null)||'data';access.fail(code);throw new DataError('FinMind 回傳格式無法辨識',null,{code,fatal:['auth','quota'].includes(code)}); }
  const status = !response.ok?response.status:Number(body.status||200);
  if (!response.ok || status !== 200) {
    const code=responseCode(response.status,body.status,String(body.msg||''))||'data';access.fail(code);
    throw new DataError('{label}：資料服務回應 {status}', { label, status }, {code,fatal:['auth','quota'].includes(code)});
  }
  if (!Array.isArray(body.data)) throw new DataError('{label}：資料欄位格式錯誤', { label });
  return body.data;
}
// 快照與日資料共用佇列與憑證閘門；不以旁路繞過停用或額度。
export async function tickSnapshot({ token, signal } = {}) {
  access.assert();
  return request('/taiwan_stock_tick_snapshot', {data_id:''}, {token,signal});
}
export async function universe(options = {}) {
  const info = await request('TaiwanStockInfo', {}, options);
  const delisted = await request('TaiwanStockDelisting', {}, options);
  return normalizeUniverse(info, delisted, options.cutoff);
}
const range = (id, from, to) => ({ ...(id ? { data_id: id } : {}), start_date: from, ...(to ? { end_date: to } : {}) });

// 當沖盤前資料（Sponsor，全市場依日期）：當日可當沖標的（盤前公布）、暫停交易、暫停先賣後買、參考價。
// 個別資料集失敗時該項留空並記下原因，其餘照用。
export function parseDayTradePrep({ list, suspended, sellFirst, limits }, date) {
  const ids = rows => [...new Set((rows || []).map(r => String(r.stock_id)))];
  const eligible = list ? ids(list.filter(r => r.date === date)) : null;
  const susp = ids((suspended || []).filter(r => r.date <= date && (!r.resumption_date || r.resumption_date > date)));
  const off = ids((sellFirst || []).filter(r => r.date <= date && (!r.end_date || r.end_date >= date)));
  const ref = Object.fromEntries((limits || []).filter(r => r.date === date && r.reference_price > 0).map(r => [String(r.stock_id), r.reference_price]));
  return { eligible: eligible?.length ? eligible : null, suspended: susp, sellFirstOff: off, ref };
}
async function dayTradePrep(date, ctx) {
  const errors = [], get = async (dataset, params) => { try { return await request(dataset, params, ctx); } catch (e) { errors.push(`${dataset}：${e.message}`); return null; } };
  const list = await get('TaiwanStockDayTrading', { start_date: date, end_date: date });
  const suspended = await get('TaiwanStockSuspended', { start_date: addDays(date, -30), end_date: date });
  const sellFirst = await get('TaiwanStockDayTradingSuspension', { start_date: addDays(date, -40), end_date: date });
  const limits = await get('TaiwanStockPriceLimit', { start_date: date, end_date: date });
  return { ...parseDayTradePrep({ list, suspended, sellFirst, limits }, date), errors };
}

export default {
  id: 'finmind', name: 'FinMind', site: 'https://finmindtrade.com', docs: 'https://finmind.github.io/', markets: ['TW'],
  key: 'required', keyEnv: 'FINMIND_API_TOKEN', interval: 1000,
  // caps提供介面能力名稱；FinMind權限判斷統一由finmind-access矩陣處理。
  caps: { dayTrade: 'sponsor', universe: 1, calendar: 1, daily: 1, adjusted: 'backer', dailyAll: 'backer', snapshot: 'sponsor', intraday: 'sponsor', news: 1, marketNews: 'sponsor', valuation: 1, revenue: 'monthly', institutional: 1, institutionalAll: 'sponsor', brokers: 'sponsor', holders: 1, flows: 1, futures: 1, margin: 1 },
  snapshotMode: 'market',
  async validate(key,{candidate=false}={}) {
    return queued(async()=>{
    access.assert({validation:true,candidate});
    const r = await fetch('https://api.web.finmindtrade.com/v2/user_info', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) }).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    if(r&&(!r.ok||j?.status&&Number(j.status)!==200)){const code=responseCode(r.status,j?.status,String(j?.msg||''));if(!candidate)access.fail(code);}
    if (!r?.ok || j?.status&&Number(j.status)!==200 || !j || !(Number(j.api_request_limit) > 0)) throw new DataError('FinMind 未接受此金鑰');
    // Official user_info documentation only guarantees usage counters. No documented
    // entitlement field: leave unknown rather than guessing from level/title/limits.
    return { plan: 'unknown', tier: 'unknown', limitHour: Number(j.api_request_limit_hour) || null };
    },{validation:true,candidate});
  },
  universe: ctx => universe(ctx),
  calendar: async (from, ctx) => [...new Set((await request('TaiwanStockTradingDate', from ? { start_date: from } : {}, ctx)).map(r => r.date))].sort(),
  daily: async (id, from, to, ctx) => {
    const price=await request(DATASETS.price,range(id,from,to),ctx);
    if(!allows(confirmedPlan(access.state().entitlement),'adjusted'))return {price,adjusted:[]};
    try { const adjusted=await request(DATASETS.adjusted,range(id,from,to),ctx);return {price,adjusted,adjustedProvenance:{kind:'adjusted',provider:'finmind',dataset:DATASETS.adjusted,from,to,fetchedAt:new Date().toISOString()}}; }
    catch { return {price,adjusted:[]}; }
  },
  dailyAll: (date, ctx) => request(DATASETS.price, range(null, date, date), ctx),
  dailyAllAdjusted: (date, ctx) => request(DATASETS.adjusted, range(null, date, date), ctx),
  snapshot: (ids, ctx) => tickSnapshot(ctx),
  intraday: async (id, date, ctx) => kbarRows(await request('TaiwanStockKBar', { data_id: id, start_date: date }, ctx), date),
  news: (id, date, ctx) => request('TaiwanStockNews', { data_id: id, start_date: date }, ctx),
  marketNews: (date, ctx) => request('TaiwanStockNews', { start_date: date }, ctx),
  valuation: (id, from, to, ctx) => request(DATASETS.valuation, range(id, from, to), ctx),
  revenue: (id, from, to, ctx) => request(DATASETS.revenue, range(id, from, to), ctx),
  institutional: (id, from, to, ctx) => request(DATASETS.institutions, range(id, from, to), ctx),
  institutionalAll: (date, ctx) => request(DATASETS.institutions, range(null, date, date), ctx),
  dayTrade: (date, ctx) => dayTradePrep(date, ctx),
  request, // 台股在地模組（法人籌碼、分點、股權分散、期貨、融資）直接使用
};
