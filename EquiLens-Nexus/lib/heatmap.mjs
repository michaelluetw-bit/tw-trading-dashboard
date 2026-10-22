// 資金板塊熱浪圖：以產業別（沒有產業資料的市場改用研究族群）聚合當日普通股成交金額與漲跌幅。
// 面積 = 成交金額，顏色 = 漲跌幅（%）。板塊漲跌幅採成交金額加權平均。資料來自目前資料源的全市場單日行情或即時快照。
import { marketToday, round, num } from './engine.mjs';
import { activeMarket } from './config.mjs';
import { liveWindow as marketLive, limitNearPct } from './markets.mjs';
import { data } from './providers/index.mjs';
import { UserError } from './i18n.mjs';
import { normalizeSector } from './sectors.mjs';
export { normalizeSector };

export const HEATMAP_VERSION = '1.0';
// 接近漲跌停的判定門檻（台股 10% 以 9.5% 判定；沒有漲跌幅限制的市場不統計漲跌停）
export const limitPct = () => limitNearPct(activeMarket());

export function validHeatDate(date, latest = marketToday()) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date))
    && new Date(date).toISOString().slice(0, 10) === date && date >= '2015-01-05' && date <= latest;
}


function stockRow(r, meta, lot) {
  const close = num(r.close), money = num(r.Trading_money), spread = num(r.spread), volume = num(r.Trading_Volume);
  if (!(close > 0) || !(money > 0)) return null;
  const prevClose = spread != null ? close - spread : null;
  const change = prevClose > 0 ? spread / prevClose * 100 : null;
  return {
    id: meta.id, name: meta.name, market: meta.market, sector: normalizeSector(meta.sector),
    close, change: round(change, 2), money, volume: volume == null ? null : round(volume / lot, 0),
    open: num(r.open), high: num(r.max), low: num(r.min),
  };
}

// sectorOf：自訂分組方式（例如以研究族群分組），預設用股票清單的產業別
export function buildHeatmap(date, { universe = [], rows = [], previous = [], previousDate = null, market = activeMarket(), sectorOf = null } = {}, errors = {}) {
  const meta = new Map(universe.map(s => [s.id, sectorOf ? { ...s, sector: sectorOf(s) } : s])), LIMIT = limitNearPct(market), lot = market.lot;
  const prevMoney = new Map();
  for (const r of previous) if (meta.has(r.stock_id) && num(r.Trading_money) > 0) prevMoney.set(r.stock_id, num(r.Trading_money));
  const stocks = [];
  const seen = new Set();
  for (const r of rows) {
    if (r.date !== date || !meta.has(r.stock_id) || seen.has(r.stock_id)) continue;
    const s = stockRow(r, meta.get(r.stock_id), lot);
    if (!s) continue;
    seen.add(r.stock_id);
    s.prevMoney = prevMoney.get(r.stock_id) ?? null;
    stocks.push(s);
  }
  const total = stocks.reduce((a, s) => a + s.money, 0);
  const groups = new Map();
  for (const s of stocks) {
    if (!groups.has(s.sector)) groups.set(s.sector, []);
    groups.get(s.sector).push(s);
  }
  const sectors = [...groups].map(([name, list]) => {
    list.sort((a, b) => b.money - a.money || a.id.localeCompare(b.id));
    const money = list.reduce((a, s) => a + s.money, 0);
    const priced = list.filter(s => s.change != null);
    const pricedMoney = priced.reduce((a, s) => a + s.money, 0);
    const both = list.filter(s => s.prevMoney > 0);
    const nowBoth = both.reduce((a, s) => a + s.money, 0), prevBoth = both.reduce((a, s) => a + s.prevMoney, 0);
    const up = priced.filter(s => s.change > 0).length, down = priced.filter(s => s.change < 0).length;
    return {
      name, count: list.length, money, share: round(total ? money / total * 100 : 0, 2),
      change: pricedMoney ? round(priced.reduce((a, s) => a + s.change * s.money, 0) / pricedMoney, 2) : null,
      median: priced.length ? round(median(priced.map(s => s.change)), 2) : null,
      up, down, flat: priced.length - up - down,
      limitUp: LIMIT ? priced.filter(s => s.change >= LIMIT).length : null,
      limitDown: LIMIT ? priced.filter(s => s.change <= -LIMIT).length : null,
      prevMoney: prevBoth || null,
      moneyChange: prevBoth > 0 ? round((nowBoth / prevBoth - 1) * 100, 1) : null,
      moneyDelta: prevBoth > 0 ? nowBoth - prevBoth : null,
      leaders: list.slice(0, 3).map(s => s.id),
      stocks: list,
    };
  }).sort((a, b) => b.money - a.money);
  const priced = stocks.filter(s => s.change != null);
  const byMarket = m => { const l = stocks.filter(s => s.market === m), p = l.filter(s => s.change != null); return { count: l.length, money: l.reduce((a, s) => a + s.money, 0), up: p.filter(s => s.change > 0).length, down: p.filter(s => s.change < 0).length, flat: p.filter(s => s.change === 0).length, limitUp: LIMIT ? p.filter(s => s.change >= LIMIT).length : null, limitDown: LIMIT ? p.filter(s => s.change <= -LIMIT).length : null }; };
  const prevTotalBoth = stocks.filter(s => s.prevMoney > 0);
  const nowB = prevTotalBoth.reduce((a, s) => a + s.money, 0), prevB = prevTotalBoth.reduce((a, s) => a + s.prevMoney, 0);
  return {
    version: HEATMAP_VERSION, date, previousDate, retrievedAt: new Date().toISOString(),
    total: {
      money: total, count: stocks.length,
      up: priced.filter(s => s.change > 0).length, down: priced.filter(s => s.change < 0).length,
      flat: priced.filter(s => s.change === 0).length,
      limitUp: LIMIT ? priced.filter(s => s.change >= LIMIT).length : null, limitDown: LIMIT ? priced.filter(s => s.change <= -LIMIT).length : null,
      change: total ? round(priced.reduce((a, s) => a + s.change * s.money, 0) / priced.reduce((a, s) => a + s.money, 0), 2) : null,
      moneyChange: prevB > 0 ? round((nowB / prevB - 1) * 100, 1) : null,
      twse: byMarket('上市'), tpex: byMarket('上櫃'),
      exchanges: Object.fromEntries([...new Set(stocks.map(s => s.market).filter(Boolean))].map(m => [m, byMarket(m)])),
    },
    sectors, errors,
    coverage: { indexed: universe.length, returned: rows.filter(r => r.date === date).length, priced: stocks.length },
    sources: [{ title: data.source('dailyAll') || data.source('snapshot') || 'local', url: '' }],
  };
}

function median(a) { const b = [...a].sort((x, y) => x - y), n = b.length; return n ? n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2 : null; }

// 找出 <= date 的最近交易日與前一交易日；若日曆無法取得，改以往前 10 個日曆日逐日嘗試。
export function resolveSessions(calendar, date) {
  const dates = [...new Set(calendar.map(r => r.date).filter(d => typeof d === 'string' && d <= date))].sort();
  return { session: dates.at(-1) || null, previous: dates.at(-2) || null };
}

// 依日期查詢全市場單日行情組成熱浪圖。fetchCalendar／fetchDaily 預設走資料源路由；測試可注入 FinMind 形式的 requestData。
export async function queryHeatmap(date, { universe = [], requestData = null, fetchCalendar = null, fetchDaily = null, sectorOf = null, ...options } = {}) {
  if (!validHeatDate(date)) throw new UserError('請選擇有效日期');
  if (!universe.length) throw new UserError('股票基本資料為空，請先更新股票基本資料');
  const cal = fetchCalendar || (requestData ? async () => (await requestData('TaiwanStockTradingDate', {}, options)).map(r => r.date) : () => data.calendar(null, options));
  const day = fetchDaily || (requestData ? d => requestData('TaiwanStockPrice', { start_date: d, end_date: d }, options) : d => data.dailyAll(d, options));
  const errors = {};
  let session = date, previousDate = null;
  try {
    const resolved = resolveSessions((await cal()).map(d => typeof d === 'string' ? { date: d } : d), date);
    if (resolved.session) { session = resolved.session; previousDate = resolved.previous; }
  } catch (e) { errors.calendar = e.message; if (e.fatal) throw e; }
  const rows = await day(session);
  if (!rows.filter(r => r.date === session).length) throw new UserError('{date} 行情尚未公布或為休市日，請稍後再查詢', { date: session });
  let previous = [];
  if (previousDate) {
    try { previous = await day(previousDate); }
    catch (e) { errors.previous = e.message; if (e.fatal) previous = []; }
  }
  const result = buildHeatmap(session, { universe, rows, previous, previousDate: previous.length ? previousDate : null, sectorOf }, errors);
  result.requestedDate = date;
  return result;
}

export function cacheableHeatmap(result, min = 100) { return result && result.total.count > Math.min(min, 20) && !result.errors.previous; }

/* ---------- 盤中即時（目前資料源的即時快照） ---------- */
export const LIVE_REFRESH_MS = 10000;
// 盤中：平日開盤到收盤後數分鐘（含收盤撮合）；國定假日由快照日期判斷
export function liveWindow(now = new Date(), market = activeMarket()) { return marketLive(market, now); }
// 快照欄位：total_amount 為累計成交金額，total_volume 為累計成交量（顯示單位，台股為張），change_price 為漲跌價差。
export function buildLiveHeatmap(snapshot, { universe = [], today = marketToday(), market = activeMarket(), sectorOf = null, refreshMs = LIVE_REFRESH_MS } = {}) {
  const meta = new Map(universe.map(s => [s.id, s]));
  const rows = [];
  let asOf = '';
  for (const r of snapshot) {
    const at = String(r.date || '');
    if (!meta.has(r.stock_id) || at.slice(0, 10) !== today) continue;
    if (at > asOf) asOf = at;
    const volume = num(r.total_volume);
    rows.push({ date: today, stock_id: r.stock_id, close: r.close, Trading_money: r.total_amount, spread: r.change_price, Trading_Volume: volume == null ? null : volume * market.lot, open: r.open, max: r.high, min: r.low });
  }
  if (!rows.length) throw Object.assign(new UserError('今日尚無盤中行情（可能為休市日或尚未開盤）'), { code: 'no-live' });
  // 盤中累計金額與前一交易日全日金額不可比，資金增減欄位留空，收盤後以日資料補上。
  const result = buildHeatmap(today, { universe, rows, market, sectorOf });
  result.live = true;
  result.asOf = asOf.replace(' ', 'T').slice(0, 19);
  result.refreshMs = refreshMs;
  return result;
}
// Shioaji 熱浪只讀既有訂閱快取，不新增訂閱、不查快照，也不寫盤後紀錄。
export function buildStreamHeatmap(rows, { subscribedIds = new Set(), connected = false, subscribedCount = 0, error = false, alive = 0, now = Date.now(), enabled = true, open = true, ...options } = {}) {
  const market = options.market || activeMarket(), date = options.today || marketToday();
  const universe = (options.universe || []).filter(s => subscribedIds.has(s.id) && market.symbolRe.test(s.id));
  const ids = new Set(universe.map(s => s.id));
  const valid = rows.filter(r => ids.has(r.stock_id) && String(r.date).slice(0,10) === date && num(r.close) > 0 && num(r.total_amount) > 0);
  const heat = valid.length ? buildLiveHeatmap(valid, { ...options, universe, today: date, market }) : null;
  const subscribed = Math.max(0, Math.min(subscribedIds.size, Number(subscribedCount) || 0));
  const status = !enabled ? 'paused' : !open ? 'closed' : !connected ? 'disconnected' : !alive || now - alive >= 75000 ? 'stale' : !heat ? 'waiting' : error || subscribed < subscribedIds.size ? 'partial' : 'live';
  const feed = { source: 'shioaji', scope: 'research', status, subscribed, symbols: subscribedIds.size, quoted: heat?.total.count || 0, asOf: heat?.asOf || null };
  return { live: open, data: ['live', 'partial'].includes(status) ? { ...heat, source: 'shioaji', scope: 'research', sources: [{ title: 'Shioaji', url: '' }] } : null, feed, refreshMs: LIVE_REFRESH_MS };
}
