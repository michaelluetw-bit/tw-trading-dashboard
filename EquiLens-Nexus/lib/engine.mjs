import { adjustedRows, trustedAdjusted } from './adjusted-data.mjs';
// 四維評分引擎：技術（還原股價均線與動能）、籌碼（法人買賣超，目前只有台股資料源提供）、話題（人工判讀事件）、
// 行業（所屬族群的趨勢與營收成長）。缺少的分項不產生綜合分數；說明文字依介面語言產生。
import { activeMarket } from './config.mjs';
import { localDate } from './markets.mjs';
import { t as tr } from './i18n.mjs';

export const WEIGHTS = { technical: 30, chips: 30, topic: 15, industry: 25 };
export const FACTORS = Object.keys(WEIGHTS);
export const VERSION = '2.0.0';
export const num = v => v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
export const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
export const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
export const round = (v, n = 1) => v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** n) / 10 ** n;
export const dateOnly = v => String(v || '').slice(0, 10);
export const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;
// 研究市場的當地日期（舊名稱 todayTW 保留給相容用途）
export const marketToday = () => localDate(activeMarket());
export const todayTW = marketToday;
export const minusDays = (date, days) => new Date(Date.parse(date) - days * 86400000).toISOString().slice(0, 10);
export function bars(rows = [], cutoff = '9999-12-31') {
  const map = new Map();
  for (const r of rows) if (dateOnly(r.date) <= cutoff && num(r.close) > 0) map.set(dateOnly(r.date), { ...r, date: dateOnly(r.date), close: num(r.close), open: num(r.open), max: num(r.max), min: num(r.min), Trading_Volume: num(r.Trading_Volume) });
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}
const ma = (p, n, offset = 0) => p.length >= n + offset ? mean(p.slice(-n - offset, offset ? -offset : undefined).map(v => v.close)) : null;
const ret = (p, n) => p.length > n ? (p.at(-1).close / p.at(-n - 1).close - 1) * 100 : null;
const missing = reason => ({ score: null, reasons: [reason], date: null });
export function technical(rows, cutoff) {
  const p = bars(rows, cutoff);
  if (p.length < 140) return { ...missing(tr('需至少 140 個交易日還原價格，目前 {n} 日', { n: p.length })), count: p.length };
  if (daysBetween(p.at(-1).date, cutoff) > 7) return { ...missing(tr('還原價格日期過舊：{date}', { date: p.at(-1).date })), count: p.length };
  const last = p.at(-1), m20 = ma(p, 20), m60 = ma(p, 60), m120 = ma(p, 120);
  const r20 = ret(p, 20), r60 = ret(p, 60), slope = (m60 / ma(p, 60, 20) - 1) * 100;
  const drawdown = (last.close / Math.max(...p.slice(-60).map(r => r.close)) - 1) * 100;
  const deviation = (last.close / m20 - 1) * 100;
  const trend = [last.close > m20, m20 > m60, m60 > m120].filter(Boolean).length / 3 * 100;
  const momentum = clamp(50 + r60 * 2);
  const stability = clamp(100 + drawdown * 4 - Math.max(0, deviation - 15) * 3);
  const score = round(trend * .4 + momentum * .25 + clamp(50 + slope * 5) * .2 + stability * .15);
  return { score, date: last.date, ma20: round(m20, 2), ma60: round(m60, 2), ma120: round(m120, 2), r20: round(r20), r60: round(r60), slope: round(slope), drawdown: round(drawdown), deviation: round(deviation), above60: last.close > m60, count: p.length,
    reasons: [tr('均線結構 {score} 分：收盤 {a}月線，月線 {b}季線', { score: Math.round(trend), a: tr(last.close > m20 ? '高於' : '低於'), b: tr(m20 > m60 ? '高於' : '低於') }), tr('近 60 日報酬 {r60}%；季線 20 日變化 {slope}%', { r60: round(r60), slope: round(slope) }), tr('距 60 日收盤高點 {dd}%；月線乖離 {dev}%', { dd: round(drawdown), dev: round(deviation) })] };
}
export function institutionalDaily(rows = [], cutoff = '9999-12-31') {
  const day = new Map();
  for (const r of rows) {
    if (dateOnly(r.date) > cutoff) continue;
    if (!day.has(dateOnly(r.date))) day.set(dateOnly(r.date), new Map());
    day.get(dateOnly(r.date)).set(r.name, r);
  }
  return [...day].sort(([a], [b]) => a.localeCompare(b)).map(([date, m]) => {
    // Dealer is the sum of Dealer_self and Dealer_Hedging: do not count both.
    const names = ['Foreign_Investor', 'Foreign_Dealer_Self', 'Investment_Trust'];
    if (m.has('Dealer')) names.push('Dealer'); else names.push('Dealer_self', 'Dealer_Hedging');
    return { date, net: names.reduce((s, n) => { const r = m.get(n); return s + (r ? (num(r.buy) ?? 0) - (num(r.sell) ?? 0) : 0); }, 0) };
  });
}
export function chips(institutions, price, cutoff, lot = 1000) {
  const p = bars(price, cutoff), flow = institutionalDaily(institutions, cutoff);
  if (flow.length < 20 || p.length < 20) return missing(tr('法人或成交量不足 20 個交易日（法人 {n} 日）', { n: flow.length }));
  const date = flow.at(-1).date;
  if (daysBetween(date, p.at(-1).date) > 5) return missing(tr('法人資料落後行情：{date}', { date }));
  const dates = new Set(p.slice(-20).map(r => r.date)), f = flow.filter(r => dates.has(r.date));
  if (f.length < 18) return missing(tr('近 20 個交易日法人資料覆蓋不足 18 日'));
  const volume = p.slice(-20).reduce((s, r) => s + (r.Trading_Volume ?? 0), 0);
  if (volume <= 0) return missing(tr('無有效成交量，無法標準化法人流向'));
  const net20 = f.reduce((s, r) => s + r.net, 0), ratio = net20 / volume * 100, positive = f.filter(r => r.net > 0).length / f.length;
  return { score: round(clamp(50 + ratio * 5) * .6 + positive * 100 * .4), date, net20: round(net20 / lot, 0), net5: round(f.slice(-5).reduce((s, r) => s + r.net, 0) / lot, 0), ratio: round(ratio, 2), positive: round(positive * 100), flow: flow.slice(-60).map(r => ({ date: r.date, net: round(r.net / lot, 0) })), reasons: [tr('近 20 日法人淨買賣 {net} 張，占成交量 {ratio}%', { net: round(net20 / lot, 0), ratio: round(ratio, 2) }), tr('法人淨買進日占比 {pct}%；不重複計入自營商合計與子項', { pct: round(positive * 100) })] };
}
// 營收年增：月營收用近 3 個月合計比去年同期；季營收（國際資料源）用最近一季比去年同季；
// 只有最新一個月資料（證交所開放資料，revenue_basis: '1m'）時先用單月年增。maxAge：可視為「最新」的天數
export function revenueGrowth(rows = [], cutoff = '9999-12-31') {
  if (rows.some(r => r.revenue_quarter != null)) return quarterlyGrowth(rows, cutoff);
  const map = new Map();
  for (const r of [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    if (dateOnly(r.create_time || r.date) <= cutoff && num(r.revenue) != null) map.set(`${r.revenue_year}-${Number(r.revenue_month)}`, r);
  }
  const sorted = [...map.values()].sort((a, b) => Number(a.revenue_year) * 12 + Number(a.revenue_month) - Number(b.revenue_year) * 12 - Number(b.revenue_month));
  const last = sorted.at(-1); if (!last) return { yoy: null, date: null };
  const prev = map.get(`${Number(last.revenue_year) - 1}-${Number(last.revenue_month)}`);
  const period = `${last.revenue_year}/${String(last.revenue_month).padStart(2, '0')}`;
  const single = () => rows.some(r => r.revenue_basis === '1m') && num(prev?.revenue) > 0
    ? { maxAge: 65, yoy: round((last.revenue / prev.revenue - 1) * 100), monthlyYoY: round((last.revenue / prev.revenue - 1) * 100), period, date: dateOnly(last.create_time || last.date), revenue: Number(last.revenue), basis: '1m' }
    : { yoy: null, date: last.date };
  const recent = sorted.slice(-3); let total = 0, prior = 0;
  for (const r of recent) { const old = map.get(`${Number(r.revenue_year) - 1}-${Number(r.revenue_month)}`); if (!old || num(old.revenue) <= 0) return single(); total += Number(r.revenue); prior += Number(old.revenue); }
  if (recent.length < 3 || recent.some((r, i) => i && Number(r.revenue_year) * 12 + Number(r.revenue_month) !== Number(recent[i - 1].revenue_year) * 12 + Number(recent[i - 1].revenue_month) + 1)) return single();
  return { maxAge: 65, yoy: round((total / prior - 1) * 100), monthlyYoY: num(prev?.revenue) > 0 ? round((last.revenue / prev.revenue - 1) * 100) : null, period, date: dateOnly(last.create_time || last.date), revenue: Number(last.revenue), basis: '3m' };
}
function quarterlyGrowth(rows, cutoff) {
  const list = rows.filter(r => dateOnly(r.create_time || r.date) <= cutoff && num(r.revenue) != null).sort((a, b) => Number(a.revenue_year) * 4 + Number(a.revenue_quarter) - Number(b.revenue_year) * 4 - Number(b.revenue_quarter));
  const last = list.at(-1); if (!last) return { yoy: null, date: null };
  const prev = list.find(r => Number(r.revenue_year) === Number(last.revenue_year) - 1 && Number(r.revenue_quarter) === Number(last.revenue_quarter));
  if (!(num(prev?.revenue) > 0)) return { yoy: null, date: dateOnly(last.date) };
  return { maxAge: 140, yoy: round((last.revenue / prev.revenue - 1) * 100), period: `${last.revenue_year} Q${last.revenue_quarter}`, date: dateOnly(last.create_time || last.date), revenue: Number(last.revenue), basis: 'quarter' };
}
export function topic(news = [], evidence = [], cutoff) {
  const recent = evidence.filter(e => e.date <= cutoff && daysBetween(e.date, cutoff) <= 90 && /^https?:\/\//.test(e.url));
  const articles = [...new Map(news.filter(n => dateOnly(n.date) <= cutoff && daysBetween(dateOnly(n.date), cutoff) <= 30).map(n => [n.link || n.title, n])).values()];
  if (!recent.length) return { ...missing(tr('尚無已人工判讀的事件；新聞熱度不直接視為利多')), newsCount: articles.length, evidence: [] };
  const weighted = recent.map(e => ({ ...e, impact: e.direction === 'positive' ? 1 : e.direction === 'negative' ? -1 : 0, weight: (e.stage === 'realized' ? 1 : e.stage === 'confirmed' ? .65 : .25) * Math.max(.1, 1 - daysBetween(e.date, cutoff) / 100) }));
  const score = clamp(50 + weighted.reduce((s, e) => s + e.impact * e.weight * 25, 0));
  return { score: round(score), date: recent.map(e => e.date).sort().at(-1), newsCount: articles.length, evidence: recent, reasons: [tr('{n} 件人工判讀事件；已實現／已確認／待驗證的影響係數為 1／0.65／0.25', { n: recent.length }), tr('事件影響隨時間衰減，90 天後不再計分；原文與判讀可逐筆檢查')] };
}
export function summarize(stock, raw = {}, evidence = [], cutoff = marketToday(), lot = activeMarket().lot) {
  const p = bars(raw.price, cutoff), tech = trustedAdjusted(raw) ? technical(adjustedRows(raw), cutoff) : missing(tr('缺可信還原股價，技術分項不可用')), c = chips(raw.institutions, raw.price, cutoff, lot), r = revenueGrowth(raw.revenue, cutoff), n = topic(raw.news, evidence, cutoff), latest = p.at(-1);
  const per = [...(raw.valuation || [])].filter(x => dateOnly(x.date) <= cutoff).sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  const previous = latest && num(latest.spread) != null && latest.close - num(latest.spread) > 0 ? latest.close - num(latest.spread) : p.at(-2)?.close;
  const freshness = latest ? daysBetween(latest.date, cutoff) : null;
  return { ...stock, asOf: latest?.date || null, price: latest?.close ?? null, change: latest && previous ? round((latest.close / previous - 1) * 100, 2) : null, volume: round(latest?.Trading_Volume / lot, 0), technical: tech, chips: c, topic: n, revenue: r, industry: missing(tr('同產業資料尚未達到覆蓋門檻')), valuation: { pe: num(per?.PER) > 0 ? num(per.PER) : null, pb: num(per?.PBR) > 0 ? num(per.PBR) : null, yield: num(per?.dividend_yield), date: per?.date || null }, stale: freshness == null || freshness > 7, spark: bars(adjustedRows(raw), cutoff).slice(-30).map(x => x.close), adjustedIsRaw: !!raw.adjustedIsRaw, adjustedTrusted: trustedAdjusted(raw), errors: raw.errors || {}, fetchedAt: raw.fetchedAt || null, bars: p.slice(-130), adjustedBars: bars(adjustedRows(raw), cutoff).slice(-150) };
}
// options.factors：目前資料源能提供的因子（例如沒有法人資料的市場不含 chips）；options.revenue：是否有營收資料
export function buildMarket(universe, rawMap, evidence = [], cutoff = marketToday(), weights = WEIGHTS, customGroups = null, { factors = FACTORS, revenue: hasRevenue = true, lot = activeMarket().lot } = {}) {
  const stocks = universe.map(s => summarize(s, rawMap[s.id], evidence.filter(e => e.stockId === s.id), cutoff, lot));
  const groups = new Map();
  if (customGroups) { const byId = new Map(stocks.map(s => [s.id, s])); for (const g of customGroups) groups.set(g.id, { id: g.id, name: g.name, stocks: g.stockIds.map(id => byId.get(id)).filter(Boolean) }); }
  else for (const s of stocks) { if (!groups.has(s.sector)) groups.set(s.sector, { id: s.sector, name: s.sector, stocks: [] }); groups.get(s.sector).stocks.push(s); }
  const sectors = [];
  for (const [, group] of groups) {
    const { name, id, stocks: all } = group;
    // 有營收資料時：趨勢＋營收成長＋動能；資料源沒有營收時：只用趨勢與動能
    const eligible = all.filter(s => !s.stale && s.technical.score != null && (!hasRevenue || s.revenue.yoy != null && daysBetween(s.revenue.date, cutoff) <= (s.revenue.maxAge || 65)));
    const coverage = all.length ? eligible.length / all.length : 0, minCount = Math.min(5, all.length);
    const breadth = eligible.length ? mean(eligible.map(s => s.technical.above60 ? 100 : 0)) : null;
    const growth = hasRevenue && eligible.length ? median(eligible.map(s => s.revenue.yoy)) : null;
    const momentum = eligible.length ? median(eligible.map(s => s.technical.r60)) : null;
    const valid = all.length > 0 && eligible.length >= minCount && coverage >= .5;
    const score = !valid ? null : hasRevenue ? round(breadth * .4 + clamp(50 + growth) * .4 + clamp(50 + momentum * 2) * .2) : round(breadth * .6 + clamp(50 + momentum * 2) * .4);
    const sector = { id, name, stockIds: all.map(s => s.id), count: all.length, covered: eligible.length, coverage: round(coverage * 100), score, breadth: round(breadth), growth: round(growth), momentum: round(momentum) };
    sectors.push(sector);
    for (const s of all) {
      const reasons = valid ? [tr('{name}：站上季線比率 {breadth}%；60 日報酬中位數 {momentum}%', { name, breadth: round(breadth), momentum: round(momentum) }), hasRevenue ? tr('近期營收年增中位數 {growth}%；涵蓋 {n}/{total} 檔', { growth: round(growth), n: eligible.length, total: all.length }) : tr('資料源沒有營收資料，族群分數只用趨勢與動能；涵蓋 {n}/{total} 檔', { n: eligible.length, total: all.length }), tr('以研究名單族群成員計算，不代表全產業或已驗證訂單前景')] : [tr('{name}：樣本 {n}/{total}；需至少 {min} 檔且覆蓋率 ≥50%', { name, n: eligible.length, total: all.length, min: minCount })];
      (s.industryContexts ||= []).push({ ...sector, date: eligible.map(e => e.asOf).sort().at(0) || null, reasons });
    }
  }
  const enabled = FACTORS.filter(k => factors.includes(k) && weights[k]>0), enabledWeight = enabled.reduce((sum, k) => sum + weights[k], 0) || 100;
  for (const s of stocks) {
    const contexts = s.industryContexts || [], validContexts = contexts.filter(c => c.score != null);
    s.industry = validContexts.length ? { score: round(mean(validContexts.map(c => c.score))), date: validContexts.map(c => c.date).sort()[0], reasons: [tr('所屬族群 {names}；{n}/{total} 個族群可計分', { names: contexts.map(c => c.name).join(tr('、')), n: validContexts.length, total: contexts.length }), ...validContexts.map(c => tr('{name} {score} 分（{n}/{total} 檔有效）；採可用族群分數等權平均', { name: c.name, score: c.score, n: c.covered, total: c.count })), ...contexts.filter(c => c.score == null).flatMap(c => c.reasons)] } : { ...missing(tr('所屬族群尚未達資料門檻')), reasons: contexts.length ? contexts.flatMap(c => c.reasons) : [tr('尚未歸入族群')] };
    if (!factors.includes('chips')) s.chips = { ...missing(tr('目前的資料源沒有法人買賣超資料，此因子不計入')), unavailable: true };
    const available = enabled.filter(k => s[k].score != null);
    const weight = available.reduce((sum, k) => sum + weights[k], 0);
    // 有效權重以「目前市場與資料源能提供的因子」為分母
    s.coverage = round(weight / enabledWeight * 100, 0); s.complete = available.length === enabled.length;
    s.score = s.complete && weight && !s.stale ? round(available.reduce((sum, k) => sum + s[k].score * weights[k], 0) / weight) : null;
    s.rating = s.score == null ? tr('缺項・不可比較') : `${s.complete ? '' : tr('暫評・')}${tr(s.score >= 75 ? '強勢' : s.score >= 55 ? '中性偏強' : s.score >= 40 ? '中性偏弱' : '弱勢')}`;
    s.risks = [];
    if (!s.complete) s.risks.push(tr('有效權重 {weight}%，缺漏分項不補零、不重配權重，暫停綜合排名', { weight: s.coverage }));
    if (s.stale) s.risks.push(tr('行情超過 7 個日曆日或尚未取得，暫停綜合評分'));
    if (s.technical.deviation > 15) s.risks.push(tr('距月線超過 15%，留意回檔風險'));
    if (s.chips.net20 < 0) s.risks.push(tr('法人近 20 日累計賣超'));
    if (s.revenue.yoy < 0) s.risks.push(tr('近期營收較去年同期衰退'));
    if (s.valuation.pe == null) s.risks.push(tr('本益比缺值或不適用，未作便宜／昂貴判斷'));
    if (!s.adjustedTrusted) s.risks.push(tr('缺可信還原股價，技術分項不可用'));
    if (s.listingNote) s.risks.push(s.listingNote);
  }
  stocks.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.id.localeCompare(b.id));
  if (!customGroups) sectors.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return { stocks, sectors, cutoff, weights, factors: enabled, version: VERSION };
}
function median(a) { const b = [...a].sort((x, y) => x - y), n = b.length; return n ? n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2 : null; }
// FinMind 台股股票清單 → 衡析股票清單（只留上市櫃普通股）
export function normalizeUniverse(rows, delisted = [], cutoff = marketToday()) {
  const map = new Map();
  const removed = new Set(delisted.filter(r => r.date <= cutoff).map(r => r.stock_id));
  for (const r of rows) {
    if (removed.has(r.stock_id)) continue;
    if (!/^[1-9]\d{3}$/.test(r.stock_id) || !['twse', 'tpex'].includes(r.type) || /ETF|ETN|受益|認購|認售|指數|存託憑證/.test(r.industry_category)) continue;
    const previous = map.get(r.stock_id);
    if (!previous || previous.sector === '電子工業') map.set(r.stock_id, { id: r.stock_id, name: r.stock_name, sector: r.industry_category || '未分類', market: r.type === 'twse' ? '上市' : '上櫃' });
  }
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
}
