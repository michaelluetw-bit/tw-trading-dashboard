// 新聞推播：每分鐘取 FinMind 全市場當日新聞（TaiwanStockNews 不帶 data_id，一次一天；約每 2 小時更新一批），
// 台股另加鉅亨網最新新聞（幾分鐘內就有），找出研究名單成分股「第一次出現」的新聞；同一篇在兩個來源只推一次。
// FinMind 的新聞時間部分來源為 UTC，不能用時間判斷新舊，改以「是否看過」判斷。
export const NEWS_DEFAULTS = { enabled: false, scope: 'all', quiet: false };
export function normalizeNews(v = {}) {
  return { enabled: v.enabled === true, scope: v.scope === 'watch' ? 'watch' : 'all', quiet: v.quiet === true };
}
export const validNewsInput = v => !!v && typeof v === 'object' && typeof v.enabled === 'boolean' && ['all', 'watch'].includes(v.scope) && typeof v.quiet === 'boolean';
export const QUIET_HOURS = [23, 7]; // 夜間勿擾：23:00–07:00 只記錄、不推播

// 不是新聞的頁面：論壇貼文、個股概覽／報價頁
export function isNoise(r) {
  const s = `${r.title || ''} ${r.link || ''}`;
  return /股市爆料同學會|討論牆|個股概覽|\/forum\/|cmoney\.tw\/finance\/\d+\/f\d+/i.test(s);
}
// 顯示用標題：去掉結尾的「 - 來源」
export const cleanTitle = t => String(t || '').replace(/\s+[-–]\s+[^-–]{1,24}$/, '').trim();
// 同一篇新聞被不同網域轉載時的比對鍵：去掉來源、空白與標點
export const titleKey = t => cleanTitle(t).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
// 連結比對鍵：去掉協定、www／tw／m 子網域、#錨點與 utm 追蹤參數；保留其他查詢參數（部分網站以 ?SN=、?a= 區分文章）
const linkKey = l => String(l || '').replace(/^https?:\/\/(www\.|tw\.|m\.)?/i, '').replace(/#.*$/, '').replace(/([?&])utm_[^&]*/gi, '$1').replace(/[?&]+$/, '').replace(/\/$/, '');

// rows → 研究名單相關的文章（同一連結或同一標題合併，彙整關聯股票）
export function collectArticles(rows, scope) {
  const out = [], byLink = new Map(), byTitle = new Map();
  for (const r of rows) {
    if (!scope.has(r.stock_id) || !r.title || isNoise(r)) continue;
    const lk = linkKey(r.link), tk = titleKey(r.title);
    let a = (lk && byLink.get(lk)) || (tk && byTitle.get(tk));
    if (!a) { a = { link: r.link, title: cleanTitle(r.title), source: r.source || '', date: r.date || '', ids: [], keys: [] }; out.push(a); }
    if (!a.ids.includes(r.stock_id)) a.ids.push(r.stock_id);
    for (const [map, k, p] of [[byLink, lk, 'l:'], [byTitle, tk, 't:']]) if (k && !map.has(k)) { map.set(k, a); a.keys.push(p + k); }
  }
  return out;
}
// state：{ seen: Map(key → 首次看到的時間), at }；第一次（或停掉超過 10 分鐘後）只記錄、不視為新聞，避免一次湧入大量舊聞
// sources：已經記錄過的新聞來源；新加入的來源第一次的文章（seedOnly）只記錄、不推播
export function createNewsState(saved) { return { seen: new Map(Object.entries(saved?.seen || {})), at: saved?.at || 0, sources: new Set(saved?.sources || []) }; }
export function scanNews(state, rows, { scope, now = Date.now(), seedOnly = [], forceSeed = false } = {}) {
  const seed = forceSeed || !state.at || now - state.at > 10 * 60e3, fresh = [];
  for (const a of collectArticles(seedOnly, scope)) for (const k of a.keys) if (!state.seen.has(k)) state.seen.set(k, now);
  for (const a of collectArticles(rows, scope)) {
    if (a.keys.some(k => state.seen.has(k))) { for (const k of a.keys) if (!state.seen.has(k)) state.seen.set(k, now); continue; }
    for (const k of a.keys) state.seen.set(k, now);
    if (!seed) fresh.push(a);
  }
  state.at = now;
  for (const [k, t] of state.seen) if (now - t > 3 * 86400e3) state.seen.delete(k); // 只保留三天
  return { fresh, seeded: seed };
}
export const saveNewsState = s => ({ at: s.at, seen: Object.fromEntries(s.seen), sources: [...(s.sources || [])] });
export const quietNow = (hour, on) => on && (hour >= QUIET_HOURS[0] || hour < QUIET_HOURS[1]);

// Added publishers seed their first non-empty batch without re-seeding each poll.
export function scanNewsSource(state, id, rows, options = {}) {
  const first = id !== 'finmind' && rows.length > 0 && !state.sources.has(id);
  const result = scanNews(state, first ? [] : rows, { ...options, seedOnly: first ? rows : [] });
  if (rows.length) state.sources.add(id);
  return result;
}
