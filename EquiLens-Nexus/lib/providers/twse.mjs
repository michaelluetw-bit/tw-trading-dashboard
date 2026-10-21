// 證交所（TWSE）與櫃買中心（TPEx）官方開放資料（台股，免金鑰）：股票清單、休市日、全市場與個股日成交、
// 三大法人買賣超、本益比與股價淨值比、最新月營收。沒有盤中即時快照與分 K，盤中功能需搭配其他資料源。
// 兩個網站都會封鎖過於頻繁的請求，因此每次請求至少間隔 2.5 秒。
import { DataError, fetchJSON, num, rocDate, ymd, weekdays, addDays } from './common.mjs';

// 證交所／櫃買產業代碼
export const INDUSTRY = { '01': '水泥工業', '02': '食品工業', '03': '塑膠工業', '04': '紡織纖維', '05': '電機機械', '06': '電器電纜', '08': '玻璃陶瓷', '09': '造紙工業', '10': '鋼鐵工業', '11': '橡膠工業', '12': '汽車工業', '14': '建材營造業', '15': '航運業', '16': '觀光餐旅', '17': '金融保險業', '18': '貿易百貨業', '19': '綜合', '20': '其他業', '21': '化學工業', '22': '生技醫療業', '23': '油電燃氣業', '24': '半導體業', '25': '電腦及週邊設備業', '26': '光電業', '27': '通信網路業', '28': '電子零組件業', '29': '電子通路業', '30': '資訊服務業', '31': '其他電子業', '32': '文化創意業', '33': '農業科技業', '34': '電子商務', '35': '綠能環保', '36': '數位雲端', '37': '運動休閒', '38': '居家生活', '80': '管理股票', '91': '存託憑證' };
const COMMON = /^[1-9]\d{3}$/;
const LABEL = '證交所／櫃買開放資料';

let last = 0, tail = Promise.resolve();
async function get(url, { signal, interval = 2500 } = {}) {
  const previous = tail; let release; tail = new Promise(r => release = r); await previous;
  try {
    const wait = Math.max(0, last + interval - Date.now()); if (wait) await new Promise(r => setTimeout(r, wait));
    last = Date.now();
    const r = await fetchJSON(url, { signal, label: LABEL, timeout: 40000 });
    if (!r.ok || r.body == null) throw new DataError('{label}：資料服務回應 {status}', { label: LABEL, status: r.status });
    return r.body;
  } finally { release(); }
}
const rwdTable = (body, re) => (body?.tables || []).find(t => re.test(t.title || '')) || null;

// 處置有價證券（上市：證交所公告；上櫃：櫃買開放資料）：處置期間涵蓋 date 的股票代號。期間為民國日期
const roc = s => { const m = /^(\d{2,3})\/?(\d{2})\/?(\d{2})$/.exec(String(s).trim()); return m ? `${Number(m[1]) + 1911}-${m[2]}-${m[3]}` : null; };
const inPeriod = (period, date) => { const [a, b] = String(period || '').split(/[～~]/).map(roc); return !!a && a <= date && (!b || b >= date); };
export function parseTwseDisposition(body, date) {
  const f = body?.fields || [], code = f.indexOf('證券代號'), per = f.indexOf('處置起迄時間');
  return [...new Set((body?.data || []).filter(r => COMMON.test(String(r[code]).trim()) && inPeriod(r[per], date)).map(r => String(r[code]).trim()))];
}
export function parseTpexDisposition(list, date) {
  return [...new Set((Array.isArray(list) ? list : []).filter(r => COMMON.test(String(r.SecuritiesCompanyCode).trim()) && inPeriod(r.DispositionPeriod, date)).map(r => String(r.SecuritiesCompanyCode).trim()))];
}
// 上櫃現股當沖交易標的（櫃買中心，盤前公布）：可當沖代號，以及暫停先賣後買的代號
export function parseTpexDayTrade(body) {
  const t = (body?.tables || []).find(x => /當沖/.test(x.title || '')) || body?.tables?.[0]; if (!t?.data?.length) return null;
  const f = t.fields || [], code = Math.max(0, f.indexOf('證券代號')), mark = f.findIndex(x => /註記/.test(x));
  const rows = t.data.map(r => [String(r[code]).trim(), mark >= 0 ? String(r[mark] ?? '').trim() : '']).filter(([id]) => id);
  return { eligible: rows.map(r => r[0]), sellFirstOff: rows.filter(r => r[1]).map(r => r[0]) };
}
export async function tpexDayTrade(date, { signal } = {}) {
  return parseTpexDayTrade(await get(`https://www.tpex.org.tw/www/zh-tw/intraday/list?date=${date.replace(/-/g, '%2F')}&response=json`, { signal }));
}
export async function dispositions(date, { signal } = {}) {
  const from = addDays(date, -30).replace(/-/g, ''), to = date.replace(/-/g, ''), out = new Set(), errors = [];
  try { for (const id of parseTwseDisposition(await get(`https://www.twse.com.tw/rwd/zh/announcement/punish?response=json&startDate=${from}&endDate=${to}`, { signal }), date)) out.add(id); } catch (e) { errors.push(e.message); }
  try { for (const id of parseTpexDisposition(await get('https://www.tpex.org.tw/openapi/v1/tpex_disposal_information', { signal }), date)) out.add(id); } catch (e) { errors.push(e.message); }
  return { ids: [...out], errors };
}
const sign = (s, v) => /-|green/.test(String(s)) ? -Math.abs(v ?? 0) : Math.abs(v ?? 0);
const tpexDate = d => d.replace(/-/g, '%2F');

// 全市場單日行情（上市＋上櫃）→ 內部日成交格式
export function parseTwseDaily(body, date) {
  const t = rwdTable(body, /每日收盤行情/); if (!t) return [];
  return t.data.filter(r => COMMON.test(r[0])).map(r => ({ date, stock_id: r[0], Trading_Volume: num(r[2]), Trading_money: num(r[4]), open: num(r[5]), max: num(r[6]), min: num(r[7]), close: num(r[8]), spread: num(r[10]) == null ? null : sign(r[9], num(r[10])) })).filter(r => r.close > 0);
}
export function parseTpexDaily(body, date) {
  const t = (body?.tables || [])[0]; if (!t) return [];
  return t.data.filter(r => COMMON.test(r[0])).map(r => ({ date, stock_id: r[0], close: num(r[2]), spread: num(String(r[3]).trim()), open: num(r[4]), max: num(r[5]), min: num(r[6]), Trading_Volume: num(r[8]), Trading_money: num(r[9]) })).filter(r => r.close > 0);
}
// 三大法人（上市 T86：股數；上櫃：股數）→ FinMind 法人格式（每股一列一身分）
export function parseTwseInstitutional(body, date) {
  const out = [];
  for (const r of body?.data || []) {
    const id = String(r[0]).trim(); if (!COMMON.test(id)) continue;
    const add = (name, buy, sell) => out.push({ date, stock_id: id, name, buy: num(buy) ?? 0, sell: num(sell) ?? 0 });
    add('Foreign_Investor', r[2], r[3]); add('Foreign_Dealer_Self', r[5], r[6]); add('Investment_Trust', r[8], r[9]); add('Dealer_self', r[12], r[13]); add('Dealer_Hedging', r[15], r[16]);
  }
  return out;
}
export function parseTpexInstitutional(body, date) {
  const t = (body?.tables || [])[0], out = [];
  for (const r of t?.data || []) {
    const id = String(r[0]).trim(); if (!COMMON.test(id)) continue;
    const add = (name, buy, sell) => out.push({ date, stock_id: id, name, buy: num(buy) ?? 0, sell: num(sell) ?? 0 });
    // 欄位：外資及陸資(不含自營) 2-4、外資自營 5-7、外資合計 8-10、投信 11-13、自營自行 14-16、自營避險 17-19、自營合計 20-22、三大法人合計 23
    add('Foreign_Investor', r[2], r[3]); add('Foreign_Dealer_Self', r[5], r[6]); add('Investment_Trust', r[11], r[12]); add('Dealer_self', r[14], r[15]); add('Dealer_Hedging', r[17], r[18]);
  }
  return out;
}

async function universe(ctx) {
  const [l, o] = await Promise.all([get('https://openapi.twse.com.tw/v1/opendata/t187ap03_L', ctx), get('https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O', ctx)]);
  const row = (id, name, code, market) => COMMON.test(id) && !['80', '91'].includes(code) ? { id, name: String(name).trim(), sector: INDUSTRY[code] || '未分類', market } : null;
  return [...l.map(r => row(String(r['公司代號']).trim(), r['公司簡稱'], r['產業別'], '上市')), ...o.map(r => row(String(r.SecuritiesCompanyCode).trim(), r.CompanyAbbreviation, r.SecuritiesIndustryCode, '上櫃'))].filter(Boolean).sort((a, b) => a.id.localeCompare(b.id));
}
// 交易日曆：平日扣除證交所公告的休市日（名稱含「開始交易」「最後交易」者是交易日）
async function calendar(from, ctx) {
  const today = new Date().toISOString().slice(0, 10), start = from || addDays(today, -400);
  let closed = new Set();
  try { const list = await get('https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule', ctx); closed = new Set(list.filter(h => !/交易日/.test(h.Name)).map(h => rocDate(h.Date)).filter(Boolean)); } catch { }
  return weekdays(start, addDays(today, 30)).filter(d => !closed.has(d));
}
async function dailyAll(date, ctx) {
  const tw = await get(`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${ymd(date)}&type=ALLBUT0999&response=json`, ctx);
  const tp = await get(`https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=${tpexDate(date)}&type=EW&response=json`, ctx);
  return [...parseTwseDaily(tw, date), ...parseTpexDaily(tp, date)];
}
// 個股歷史：每月一次請求（上市 STOCK_DAY、上櫃 tradingStock）；先試上市，查無資料再試上櫃
async function daily(id, from, to, ctx) {
  const months = []; for (let d = from.slice(0, 7) + '-01'; d <= to; d = addDays(d, 32).slice(0, 7) + '-01') months.push(d);
  let otc = null, rows = [];
  for (const m of months) {
    if (otc !== true) {
      const b = await get(`https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=${ymd(m)}&stockNo=${id}&response=json`, ctx);
      if (b.stat === 'OK' && b.data?.length) { otc = false; rows.push(...b.data.map(r => ({ date: rocDate(r[0]), stock_id: id, Trading_Volume: num(r[1]), Trading_money: num(r[2]), open: num(r[3]), max: num(r[4]), min: num(r[5]), close: num(r[6]), spread: num(r[7]) }))); continue; }
      if (otc === false) continue;
    }
    const b = await get(`https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?code=${id}&date=${tpexDate(m)}&response=json`, ctx), t = b?.tables?.[0];
    if (t?.data?.length) { otc = true; rows.push(...t.data.map(r => ({ date: rocDate(r[0]), stock_id: id, Trading_Volume: (num(r[1]) ?? 0) * 1000, Trading_money: (num(r[2]) ?? 0) * 1000, open: num(r[3]), max: num(r[4]), min: num(r[5]), close: num(r[6]), spread: num(r[7]) }))); }
  }
  const price = rows.filter(r => r.date && r.date >= from && r.date <= to && r.close > 0);
  return { price, adjusted: price, adjustedIsRaw: true };
}
const t86Url = date => `https://www.twse.com.tw/rwd/zh/fund/T86?date=${ymd(date)}&selectType=ALLBUT0999&response=json`;
const tpexInstitutionalUrl = date => `https://www.tpex.org.tw/www/zh-tw/insti/dailyTrade?type=Daily&sect=EW&date=${tpexDate(date)}&response=json`;
async function institutionalAll(date, ctx) {
  const tw = await get(t86Url(date), ctx);
  const tp = await get(tpexInstitutionalUrl(date), ctx);
  return [...parseTwseInstitutional(tw, date), ...parseTpexInstitutional(tp, date)];
}
// 回應中的日期（T86 與櫃買都是 YYYYMMDD）→ YYYY-MM-DD；沒有日期（例如休市日 T86 只回 stat）時為 null
const responseDate = body => { const s = String(body?.date ?? ''); return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null; };
// 備援專用的嚴格股數解析：只接受整數格式（可含千分位），空白、Tab、單獨逗號、文字一律視為非法，不補 0；超出安全整數也視為非法。
// 共用的 num() 會把全空白、Tab、單獨逗號轉成 0，所以這裡不使用它（研究評分用的原解析函式不受影響）。
export function strictShares(v) {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).trim();
  if (!/^-?\d{1,3}(,\d{3})*$/.test(s) && !/^-?\d+$/.test(s)) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isSafeInteger(n) ? n : null;
}
// 表頭核對（零起算索引）：上市 T86 用欄名；上櫃欄名重複，核對欄數、首尾欄名與各組買進、賣出、買賣超的順序
// 欄名用正規表示式比對（完全相符），與 rwdTable() 的寫法一致；這些是資料來源的表頭，不是介面文字
const T86_FIELDS = { 0: /^證券代號$/, 2: /^外陸資買進股數\(不含外資自營商\)$/, 3: /^外陸資賣出股數\(不含外資自營商\)$/, 5: /^外資自營商買進股數$/, 6: /^外資自營商賣出股數$/, 8: /^投信買進股數$/, 9: /^投信賣出股數$/, 12: /^自營商買進股數\(自行買賣\)$/, 13: /^自營商賣出股數\(自行買賣\)$/, 15: /^自營商買進股數\(避險\)$/, 16: /^自營商賣出股數\(避險\)$/, 18: /^三大法人買賣超股數$/ };
const t86HeaderOk = f => Array.isArray(f) && f.length >= 19 && Object.entries(T86_FIELDS).every(([i, re]) => re.test(String(f[i] ?? '')));
const tpexHeaderOk = f => Array.isArray(f) && f.length === 24 && /^代號$/.test(f[0]) && /^三大法人買賣超股數合計$/.test(f[23]) && [2, 5, 8, 11, 14, 17, 20].every(i => /^買進股數$/.test(f[i]) && /^賣出股數$/.test(f[i + 1]) && /^買賣超股數$/.test(f[i + 2]));
// 欄位位置（買進、賣出）：外資、外資自營商、投信、自營商自行買賣、自營商避險
const T86_COLS = [['Foreign_Investor', 2, 3], ['Foreign_Dealer_Self', 5, 6], ['Investment_Trust', 8, 9], ['Dealer_self', 12, 13], ['Dealer_Hedging', 15, 16]];
const TPEX_COLS = [['Foreign_Investor', 2, 3], ['Foreign_Dealer_Self', 5, 6], ['Investment_Trust', 11, 12], ['Dealer_self', 14, 15], ['Dealer_Hedging', 17, 18]];
// 原始列 → { rows, invalid }：範圍判斷交給呼叫端（invalid 附代號），這裡只略過非普通股代號格式的有效列
function strictInstitutional(data, cols, minLen, date, market) {
  const rows = [], invalid = [];
  for (const r of Array.isArray(data) ? data : []) {
    const id = String(r?.[0] ?? '').trim();
    if (!id) continue;
    if (!Array.isArray(r) || r.length < minLen) { invalid.push({ stock_id: id, market, reason: 'short row' }); continue; }
    const vals = cols.map(([name, b, s]) => [name, strictShares(r[b]), strictShares(r[s])]);
    if (vals.some(([, b, s]) => b == null || s == null)) { invalid.push({ stock_id: id, market, reason: 'invalid number' }); continue; }
    if (COMMON.test(id)) for (const [name, buy, sell] of vals) rows.push({ date, stock_id: id, name, buy, sell });
  }
  return { rows, invalid };
}
// 全市場個股法人，上市與上櫃分開回報（法人／期貨籌碼頁的備援用）：各市場的回應日期、股票檔數、錯誤與格式不符的列，由呼叫端判斷是否完整。
// 一個市場失敗不影響另一個市場；表頭不符時整個市場不採用。
export async function institutionalAllChecked(date, ctx) {
  const one = async (url, market) => {
    try {
      const body = await get(url, ctx);
      const table = market === 'twse' ? { fields: body?.fields, data: body?.data } : (body?.tables || [])[0] || {};
      const data = Array.isArray(table.data) ? table.data : [];
      if (data.length && !(market === 'twse' ? t86HeaderOk(table.fields) : tpexHeaderOk(table.fields))) return { rows: [], invalid: [], date: responseDate(body), count: 0, error: '欄位格式不符' };
      const { rows, invalid } = strictInstitutional(data, market === 'twse' ? T86_COLS : TPEX_COLS, market === 'twse' ? 19 : 24, date, market);
      return { rows, invalid, date: responseDate(body), count: new Set(rows.map(r => r.stock_id)).size, error: null };
    } catch (e) { return { rows: [], invalid: [], date: null, count: 0, error: e.message }; }
  };
  const twse = await one(t86Url(date), 'twse'), tpex = await one(tpexInstitutionalUrl(date), 'tpex');
  const info = m => ({ date: m.date, count: m.count, error: m.error });
  return { rows: [...twse.rows, ...tpex.rows], invalid: [...twse.invalid, ...tpex.invalid], markets: { twse: info(twse), tpex: info(tpex) } };
}
// 最新的本益比／殖利率／股價淨值比（上市＋上櫃全市場一次取回，個股查詢時快取共用）
let valuationCache = { at: 0, map: new Map() };
async function valuationMap(ctx) {
  if (Date.now() - valuationCache.at < 6 * 3600e3 && valuationCache.map.size) return valuationCache.map;
  const map = new Map();
  for (const r of await get('https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL', ctx)) map.set(String(r.Code).trim(), { date: rocDate(r.Date), PER: num(r.PEratio), PBR: num(r.PBratio), dividend_yield: num(r.DividendYield) });
  for (const r of await get('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis', ctx)) map.set(String(r.SecuritiesCompanyCode).trim(), { date: rocDate(r.Date), PER: num(r.PriceEarningRatio), PBR: num(r.PriceBookRatio), dividend_yield: num(r.YieldRatio) });
  valuationCache = { at: Date.now(), map }; return map;
}
// 最新月營收（含去年同月）→ FinMind 月營收格式；長期執行後逐月累積，即可計算近 3 個月年增
let revenueCache = { at: 0, map: new Map() };
async function revenueMap(ctx) {
  if (Date.now() - revenueCache.at < 6 * 3600e3 && revenueCache.map.size) return revenueCache.map;
  const map = new Map();
  for (const url of ['https://openapi.twse.com.tw/v1/opendata/t187ap05_L', 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O']) {
    for (const r of await get(url, ctx)) {
      const id = String(r['公司代號']).trim(), ym = String(r['資料年月']), y = Number(ym.slice(0, -2)) + 1911, m = Number(ym.slice(-2)), date = rocDate(r['出表日期']);
      if (!COMMON.test(id) || !y || !m) continue;
      map.set(id, [{ date, stock_id: id, revenue_year: y - 1, revenue_month: m, revenue: (num(r['營業收入-去年當月營收']) ?? 0) * 1000, create_time: date, revenue_basis: '1m' }, { date, stock_id: id, revenue_year: y, revenue_month: m, revenue: (num(r['營業收入-當月營收']) ?? 0) * 1000, create_time: date, revenue_basis: '1m' }]);
    }
  }
  revenueCache = { at: Date.now(), map }; return map;
}

export default {
  id: 'twse', name: '證交所／櫃買中心 開放資料', site: 'https://openapi.twse.com.tw', docs: 'https://openapi.twse.com.tw', markets: ['TW'],
  key: 'none', interval: 2500,
  caps: { universe: 1, calendar: 1, daily: 1, dailyAll: 1, institutional: 'bulk', institutionalAll: 1, valuation: 1, revenue: 'monthly' },
  universe, calendar, dailyAll, daily, institutionalAll, institutionalAllChecked,
  // 個股法人：以全市場單日資料組成（研究名單更新時批次取得，見 research.mjs）
  institutional: async () => { throw new DataError('{label}：法人資料需以全市場批次更新', { label: LABEL }); },
  valuation: async (id, from, to, ctx) => { const v = (await valuationMap(ctx)).get(id); return v ? [{ stock_id: id, ...v }] : []; },
  revenue: async (id, from, to, ctx) => (await revenueMap(ctx)).get(id) || [],
};
