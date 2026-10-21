// 衡析 Nexus 本機 API 用戶端：手機版不直接讀寫資料，只透過 Nexus（單一寫入者）取得與觸發查詢。
export const NEXUS_URL = process.env.NEXUS_URL || 'http://127.0.0.1:4330';
let csrf = null, stateCache = null, patternCache = null;

export class NexusError extends Error { constructor(message, status = 502) { super(message); this.status = status; } }

async function call(path, { body, timeout = 20000, retry = true } = {}) {
  let res;
  try {
    if (body !== undefined && !csrf) await state(true);
    res = await fetch(NEXUS_URL + '/api/' + path, body === undefined ? { signal: AbortSignal.timeout(timeout) } : {
      method: 'POST', signal: AbortSignal.timeout(timeout),
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf || '' }, body: JSON.stringify(body),
    });
  } catch (e) {
    throw new NexusError(e?.name === 'TimeoutError' ? '衡析 Nexus 回應逾時，請稍後再試' : '電腦上的衡析 Nexus 未啟動或無法連線', 503);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 403 && body !== undefined && retry) { csrf = null; return call(path, { body, timeout, retry: false }); }
  if (!res.ok) throw new NexusError(data.error || `Nexus 回應 ${res.status}`, res.status === 404 ? 404 : res.status === 409 ? 409 : 400);
  return data;
}

export async function state(force = false) {
  if (!force && stateCache && Date.now() - stateCache.at < 4000) return stateCache.data;
  const data = await call('state');
  csrf = data.csrf; stateCache = { at: Date.now(), data };
  return data;
}
export function invalidate() { stateCache = null; }
export async function patterns(force = false) {
  const s = await state();
  const key = `${s.cutoff}|${s.job?.finishedAt || ''}`;
  if (!force && patternCache && patternCache.key === key && Date.now() - patternCache.at < 300000) return patternCache.data;
  const data = await call('patterns', { timeout: 60000 });
  patternCache = { key, at: Date.now(), data };
  return data;
}
export const detail = id => call('detail?id=' + encodeURIComponent(id));
export const patternDetail = id => call('pattern-detail?id=' + encodeURIComponent(id));
export const heatmap = date => call('heatmap?date=' + encodeURIComponent(date || 'latest'));
export const heatmapLive = () => call('heatmap/live', { timeout: 30000 });
export const heatmapQuery =date => call('heatmap/query', { body: { date }, timeout: 180000 }).finally(invalidate);
export const flows = date => call('flows?date=' + encodeURIComponent(date));
export const flowsQuery = date => call('flows/query', { body: { date }, timeout: 300000 });
// 手機端觸發資料更新（僅更新行情／型態／新聞；金鑰、設定、族群編輯仍只能在電腦上操作）。
export const job = () => call('job', { timeout: 5000 });
export const update = (scope, ids = []) => call('update', { body: { scope, ids } }).finally(invalidate);
export const patternUpdate = () => call('pattern-update', { body: {} }).finally(invalidate);
export const stockNews = id => call('news', { body: { id } }).finally(invalidate);
export const cancel = () => call('cancel', { body: {} }).finally(invalidate);
// 盤中監控、雷達、看板、時光機、籌碼深度、AI 日報
const qs = o => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '')).toString();
export const monitor = () => call('monitor');
export const monitorSettings = b => call('monitor/settings', { body: b });
// 當沖掃描（設定只能在電腦版修改）
export const daytrade = () => call('daytrade');
export const daytradeReview = () => call('daytrade/review');
export const newsSettings = b => call('news/settings', { body: b });
export const alerts = (since = 0, date) => call('alerts?' + qs({ since, date }), { timeout: 8000 });
export const board = (ids, group) => call('board?' + qs({ ids: ids?.join(','), group }));
export const replayDays = () => call('replay/days');
export const replay = date => call('replay?' + qs({ date }), { timeout: 30000 });
export const replayFrame = (date, i) => call('replay/frame?' + qs({ date, i }));
export const chart = (id, period) => call('chart?' + qs({ id, period }), { timeout: 60000 });
export const index = id => call('index?' + qs({ id }), { timeout: 20000 });
export const intraday = (id, group) => call('intraday?' + qs({ id, group: group || undefined }), { timeout: 15000 });
export const brokers = (id, days) => call('brokers?' + qs({ id, days }), { timeout: 120000 });
export const holders = id => call('holders?' + qs({ id }), { timeout: 60000 });
export const report = date => call('report?' + qs({ date }));
export const priceAlerts = () => call('price-alerts');
export const priceAlertSave = b => call('price-alerts', { body: b });
export const priceAlertDelete = id => call('price-alerts/delete', { body: { id } });
export const chipwatch = date => call('chipwatch?' + qs({ date }));
export const chipwatchQuery = b => call('chipwatch/query', { body: b, timeout: 300000 });
export const chipwatchSettings = b => call('chipwatch/settings', { body: b });
export const brokerSearch = q => call('chipwatch/branches?' + qs({ q }), { timeout: 60000 });
export const holderRank = (scope, date) => call('holders/rank?' + qs({ scope, date }));
export const holderRankQuery = () => call('holders/rank/query', { body: {}, timeout: 300000 });
export const grouprank = date => call('grouprank?' + qs({ date }));
export const grouprankQuery = () => call('grouprank/query', { body: {}, timeout: 60000 });
export const reportCard =date => call('report/card?' + qs({ date }), { timeout: 120000 });
export const reportGenerate =date => call('report/generate', { body: date ? { date } : {} });
export const setWatchlist = ids => call('watchlist', { body: { ids } }).finally(invalidate);
export const watchSet = b => call('watch/set', { body: b }).finally(invalidate);
export const groupStockAdd = (groupId, stockId) => call('group-stocks', { body: { groupId, stockId } }).finally(invalidate);
export const watchGroups = groups => call('watch/groups', { body: { groups } }).finally(invalidate);
// 研究名單以外的自選股（沒有評分）：名稱、最新價與型態訊號
export const slimWatchExtra = s => ({ id: s.id, name: s.name, market: s.market, sector: s.sector, price: s.price, change: s.change, asOf: s.asOf, patterns: (s.patterns || []).slice(0, 3).map(p => ({ id: p.id, name: p.name, status: p.status })) });
export const health = () => call('health', { timeout: 3000 });
export const profile = () => call('profile', { timeout: 5000 });
// 介面翻譯字典（Nexus 的 /locales/<lang>.json）
export async function locale(lang) { const r = await fetch(`${NEXUS_URL}/locales/${encodeURIComponent(lang)}.json`, { signal: AbortSignal.timeout(5000) }); if (!r.ok) throw new Error('locale'); return Buffer.from(await r.arrayBuffer()); }
export const briefingNews = (offset, refresh) => call(`briefing/news?offset=${offset}${refresh ? '&refresh=1' : ''}`, { timeout: 60000 });
export const briefingWeek = refresh => call(`briefing/week${refresh ? '?refresh=1' : ''}`, { timeout: 90000 });

/* ---------- 精簡資料（手機流量與閱讀） ---------- */
const r1 = v => v == null ? null : Math.round(v * 10) / 10;
export function slimStock(s, watch = []) {
  return {
    id: s.id, name: s.name, market: s.market, sector: s.sector, groups: s.groupNames || [], asOf: s.asOf,
    price: s.price, change: s.change, volume: s.volume, score: s.score, rating: s.rating, complete: s.complete, coverage: s.coverage,
    f: [s.technical?.score, s.chips?.score, s.topic?.score, s.industry?.score].map(r1),
    spark: (s.spark || []).filter((_, i, a) => i % 2 === 0 || i === a.length - 1),
    watch: watch.includes(s.id),
  };
}
export function slimGroup(g) { return { id: g.id, name: g.name, score: g.score, count: g.count, covered: g.covered, breadth: g.breadth, growth: g.growth, momentum: g.momentum, stockIds: g.stockIds }; }
export function slimPatternRows(p) {
  return (p.stocks || []).flatMap(s => s.matches.map(m => ({
    id: s.id, name: s.name, sector: s.sector, market: s.market, price: s.price, avg5: s.avg5,
    pid: m.id, pattern: m.name, category: m.category, score: m.score, status: m.status,
    entry: m.plan?.entry, entryMax: m.plan?.entryMax, stop: m.plan?.stop, target: m.plan?.target, rr: m.plan?.rr, action: m.plan?.action,
  }))).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
export function slimDetail(s) {
  const bars = (s.adjustedBars || []);
  const ma = n => bars.map((_, i) => i >= n - 1 ? r2(bars.slice(i - n + 1, i + 1).reduce((a, r) => a + r.close, 0) / n) : null);
  const [m20, m60] = [ma(20), ma(60)];
  const k = bars.slice(-90), off = bars.length - k.length;
  return {
    id: s.id, name: s.name, market: s.market, sector: s.sector, groups: s.groupNames || [], asOf: s.asOf, price: s.price, change: s.change, volume: s.volume,
    score: s.score, rating: s.rating, complete: s.complete, coverage: s.coverage, risks: s.risks || [],
    factors: ['technical', 'chips', 'topic', 'industry'].map(key => ({ key, score: s[key]?.score ?? null, date: s[key]?.date || null, reasons: s[key]?.reasons || [] })),
    tech: { ma20: s.technical?.ma20, ma60: s.technical?.ma60, ma120: s.technical?.ma120, r20: s.technical?.r20, r60: s.technical?.r60 },
    chips: { net5: s.chips?.net5, net20: s.chips?.net20, positive: s.chips?.positive },
    valuation: s.valuation || {}, revenue: s.revenue || {}, history: s.history || null,
    bars: k.map((r, i) => [r.date, r.open ?? r.close, r.max ?? r.close, r.min ?? r.close, r.close, m20[off + i], m60[off + i]]),
    news: (s.news || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 12).map(n => ({ title: n.title, date: n.date, source: n.source, url: n.link })),
    evidence: (s.evidence || []).map(e => ({ title: e.title, date: e.date, direction: e.direction, stage: e.stage, url: e.url })),
  };
}
const r2 = v => v == null ? null : Math.round(v * 100) / 100;
export function slimFlows(d) {
  if (!d) return null;
  const pick = id => d.rankings?.find(r => r.id === id);
  return {
    date: d.date, retrievedAt: d.retrievedAt, summary: d.summary, futures: d.futures,
    options: { positions: d.options?.positions || [] },
    top: ['twse-total', 'tpex-total', 'twse-foreign', 'twse-trust'].map(pick).filter(Boolean).map(r => ({ id: r.id, title: r.title, buy: r.buy.slice(0, 10), sell: r.sell.slice(0, 10) })),
  };
}
