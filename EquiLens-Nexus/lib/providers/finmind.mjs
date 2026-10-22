// FinMind（台股）：股票清單、交易日曆、日成交與還原股價、法人、月營收、本益比、個股新聞、股權分散、期貨與融資。
// Sponsor 方案另有：全市場即時快照、分 K、全市場單日資料、全市場新聞、券商分點。
import { finmindAccess, operationKey, classifyResponse, retryDeadline } from '../finmind-access.mjs';
import { getSecret } from '../secrets.mjs';
import { normalizeUniverse } from '../engine.mjs';
import { kbarRows } from '../insight.mjs';
import { DataError, stopped, sleep, addDays } from './common.mjs';

export const DATASETS = { price: 'TaiwanStockPrice', adjusted: 'TaiwanStockPriceAdj', institutions: 'TaiwanStockInstitutionalInvestorsBuySell', revenue: 'TaiwanStockMonthRevenue', valuation: 'TaiwanStockPER' };
// The daily queue and snapshots keep separate scheduling, but share credential gates.
export function createFinmindTransport({ access: injectedAccess, readSecret = () => getSecret('finmind','FINMIND_API_TOKEN'), fetcher = (...args) => fetch(...args), timeout = ms => AbortSignal.timeout(ms), now = Date.now, wait = sleep } = {}) {
  let lastRequest = 0, requestTail = Promise.resolve(), manager;
  const active = new Set();
  const gate = () => {
    if (!manager) {
      manager = injectedAccess || finmindAccess();
      manager.onGenerationChange(generation => { for (const item of active) if (item.generation !== generation) item.controller.abort(); });
    }
    return manager;
  };
  async function send(ticket, url, {token,signal,timeoutMs=45000,validation=false,candidate=false,daily=false} = {}) {
    const a=gate();a.assertCurrent(ticket);
    if(signal?.aborted)throw stopped();
    const secret=token ?? await readSecret();a.assertCurrent(ticket);
    if(signal?.aborted)throw stopped();
    if(!secret)throw new DataError('FinMind 尚未設定金鑰',null,{code:'auth',fatal:true});
    const item={generation:ticket.generation,controller:new AbortController()};active.add(item);
    try {
      let response;
      try {if(daily)lastRequest=now();response=await fetcher(url,{headers:{Authorization:`Bearer ${secret}`},signal:AbortSignal.any([item.controller.signal,timeout(timeoutMs),...(signal?[signal]:[])])});}
      catch {a.assertCurrent(ticket);if(signal?.aborted||item.controller.signal.aborted)throw stopped();throw new DataError('FinMind 連線失敗或逾時');}
      a.assertCurrent(ticket);if(signal?.aborted)throw stopped();
      const body=await response.json().catch(()=>null);
      a.assertCurrent(ticket);if(signal?.aborted)throw stopped();
      if(!response.ok || body?.status && Number(body.status)!==200) {
        const kind=classifyResponse(response.status,body?.status,String(body?.msg||''));
        if(!candidate)a.record(ticket,{kind,retryAt:kind==='quota'?retryDeadline(response.headers?.get('retry-after'),now()):undefined});
        if(kind==='plan')throw new DataError('FinMind 此項資料遭來源拒絕（Sponsor 權限）',null,{code:'plan'});
        throw new DataError('FinMind 資料請求未成功（{status}）',{status:response.status===200?Number(body?.status):response.status},{code:kind,fatal:['auth','quota'].includes(kind)});
      }
      if(validation) {
        if(!(Number(body?.api_request_limit)>0))throw new DataError('FinMind 未接受此金鑰');
        return {plan:'unknown',tier:'unknown',limitHour:Number(body.api_request_limit_hour)||null};
      }
      if(!Array.isArray(body?.data))throw new DataError('FinMind 回傳格式無法辨識');
      a.record(ticket,{kind:'success'});return body.data;
    } finally {active.delete(item);}
  }
  async function request(dataset,params={}, {interval=7000,token,signal,timeout:timeoutMs=45000}={}) {
    const a=gate(),ticket=a.capture(operationKey(dataset,params));
    const previous=requestTail;let release;requestTail=new Promise(r=>release=r);
    await previous;
    try {
      a.assertCurrent(ticket);if(signal?.aborted)throw stopped();
      const delay=Math.max(0,lastRequest+interval-now());if(delay)await wait(delay,signal);
      a.assertCurrent(ticket);if(signal?.aborted)throw stopped();
      const endpoint=dataset.startsWith('/'),url=new URL(`https://api.finmindtrade.com/api/v4${endpoint?dataset:'/data'}`);
      url.search=new URLSearchParams(endpoint?params:{dataset,...params}).toString();
      return await send(ticket,url,{token,signal,timeoutMs,daily:true});
    } finally {release();}
  }
  const tickSnapshot=async ({token,signal}={})=>{
    const ticket=gate().capture('/taiwan_stock_tick_snapshot');
    return send(ticket,new URL('https://api.finmindtrade.com/api/v4/taiwan_stock_tick_snapshot?data_id='),{token,signal,timeoutMs:20000});
  };
  const validate=async (key,{candidate=true}={})=>{
    const ticket=gate().capture('/v2/user_info',true);
    return send(ticket,new URL('https://api.web.finmindtrade.com/v2/user_info'),{token:key,timeoutMs:20000,validation:true,candidate});
  };
  return {request,tickSnapshot,validate};
}
const transport=createFinmindTransport();
export const request=(...args)=>transport.request(...args);
export const tickSnapshot=async (...args)=>transport.tickSnapshot(...args);

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
  // 1：免費可用；'sponsor'：需 Sponsor 方案
  caps: { dayTrade: 'sponsor', universe: 1, calendar: 1, daily: 1, adjusted: 1, dailyAll: 'sponsor', snapshot: 'sponsor', intraday: 'sponsor', news: 1, marketNews: 'sponsor', valuation: 1, revenue: 'monthly', institutional: 1, institutionalAll: 'sponsor', brokers: 'sponsor', holders: 1, flows: 1, futures: 1, margin: 1 },
  snapshotMode: 'market',
  validate: (...args) => transport.validate(...args),
  universe: ctx => universe(ctx),
  calendar: async (from, ctx) => [...new Set((await request('TaiwanStockTradingDate', from ? { start_date: from } : {}, ctx)).map(r => r.date))].sort(),
  daily: async (id, from, to, ctx) => ({ price: await request(DATASETS.price, range(id, from, to), ctx), adjusted: await request(DATASETS.adjusted, range(id, from, to), ctx) }),
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
