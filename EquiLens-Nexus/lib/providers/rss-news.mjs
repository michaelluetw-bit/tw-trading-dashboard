// Fixed publisher RSS feeds. Summaries are used only for conservative local matching.
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { DataError } from './common.mjs';
export const RSS_SOURCES = Object.freeze({
  technews: Object.freeze({ name: '科技新報', url: 'https://technews.tw/news-rss/', domain: 'technews.tw' }),
  ltn: Object.freeze({ name: '自由財經', url: 'https://news.ltn.com.tw/rss/business.xml', domain: 'ltn.com.tw' }),
});
export const RSS_INTERVAL = 5 * 60e3;
const MAX_BYTES = 1024 * 1024;
const fail = () => new DataError('RSS 新聞讀取失敗，請稍後重試');
const parser = new XMLParser({ parseTagValue: false, ignoreAttributes: true, ignoreDeclaration: true, maxNestedTags: 30 });
const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
const text = value => typeof value === 'string' ? value : '';
// This is text cleanup after XML parsing, never a parser for the feed itself.
// Drop linked recommendations entirely so their company names are not article evidence.
const plain = value => {
  const raw = text(value);
  // Encoded markup is not reliable summary evidence; do not recover names from it.
  if (/&(?:lt|#0*60|#x0*3c);/i.test(raw)) return '';
  return raw.replace(/<(script|style|a)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|amp|lt|gt|quot|apos);/g, ' ').replace(/\s+/g, ' ').trim();
};
const normalized = value => value.normalize('NFKC').toLowerCase().trim();
const ambiguous = /^(世界|統一|大同|台灣大|中華)$/u;
function matchingIndex(stocks, scope) {
  const ids = new Set(), names = new Map(), byId = new Map();
  for (const stock of stocks) {
    const id = String(stock.id || ''), name = normalized(text(stock.name));
    if (!/^[1-9]\d{3}$/.test(id) || !['上市', '上櫃', 'TWSE', 'TPEx', 'TPEX'].includes(stock.market)) continue;
    if (scope.has(id)) ids.add(id);
    byId.set(id, name);
    if (name) { const matches = names.get(name) || new Set(); matches.add(id); names.set(name, matches); }
  }
  return { ids, names, byId };
}
function match(title, summary, categories, index) {
  const found = new Set(), body = normalized(`${title} ${summary}`);
  for (const pattern of [/(?:股票代號|股票代碼|證券代號|代號)\s*[:：]?\s*([1-9]\d{3})(?!\d)/g, /(?<![\w\d])([1-9]\d{3})\.(?:tw|two)\b/g]) {
    for (const m of body.matchAll(pattern)) if (index.ids.has(m[1])) found.add(m[1]);
  }
  for (const m of body.matchAll(/[（(]\s*([1-9]\d{3})\s*[）)]/g)) {
    const yearLike = Number(m[1]) >= 1900 && Number(m[1]) <= 2099;
    const preceding = body.slice(0, m.index).trimEnd(), company = index.byId.get(m[1]);
    if (index.ids.has(m[1]) && (!yearLike || company && preceding.endsWith(company))) found.add(m[1]);
  }
  for (const [name, matches] of index.names) {
    if (matches.size !== 1 || ambiguous.test(name) || /[縣市鄉鎮區]$/.test(name)) continue;
    const id = [...matches][0]; if (!index.ids.has(id)) continue;
    if (categories.some(category => normalized(category) === name)) { found.add(id); continue; }
    if ([...name].length < 3 || /^[\d\p{P}\p{S}\s]+$/u.test(name)) continue;
    // A longer catalog name containing this one would make a substring ambiguous.
    if ([...index.names.keys()].some(other => other !== name && other.includes(name) && body.includes(other))) continue;
    if (body.includes(name)) found.add(id);
  }
  return [...found];
}
function articleURL(value, domain) {
  try {
    const url = new URL(text(value));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || !(url.hostname === domain || url.hostname.endsWith('.' + domain))) return null;
    return url.href;
  } catch { return null; }
}
function articleDate(value, now) {
  const s = text(value).trim();
  if (s.length < 16 || !/\b\d{4}\b/.test(s) || !/(?:GMT|UTC|[+-]\d{4}|Z|[+-]\d{2}:\d{2})$/i.test(s)) return null;
  const rfc = /(?:^|,\s*)(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/.exec(s), iso = /^(\d{4})-(\d{2})-(\d{2})T/.exec(s);
  if (!rfc && !iso) return null;
  const year = Number(iso ? iso[1] : rfc[3]), month = iso ? Number(iso[2]) - 1 : ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(rfc[2].toLowerCase()), day = Number(iso ? iso[3] : rfc[1]);
  const calendar = new Date(Date.UTC(year, month, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month || calendar.getUTCDate() !== day) return null;
  const time = Date.parse(s);
  if (!Number.isFinite(time) || time > now + 5 * 60e3) return null;
  return new Date(time).toISOString();
}
export function parseRssNews(id, xml, { stocks = [], scope = new Set(), now = Date.now() } = {}) {
  const source = RSS_SOURCES[id];
  if (!source || typeof xml !== 'string' || Buffer.byteLength(xml, 'utf8') > MAX_BYTES || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw fail();
  let parsed;
  try { if (XMLValidator.validate(xml) !== true) throw fail(); parsed = parser.parse(xml); } catch { throw fail(); }
  const root = parsed?.rss, channel = root?.channel;
  if (!root || !Object.hasOwn(root, 'channel') || Array.isArray(channel) || channel !== '' && (!channel || typeof channel !== 'object')) throw fail();
  const index = matchingIndex(stocks, scope), rows = [];
  for (const entry of list(channel?.item).slice(0, 100)) {
    const title = plain(entry?.title).slice(0, 500), link = articleURL(entry?.link, source.domain), date = articleDate(entry?.pubDate, now);
    if (!title || !link || !date) continue;
    const summary = plain(entry.description).slice(0, 1500), categories = list(entry.category).map(plain);
    for (const stock_id of match(title, summary, categories, index)) rows.push({ stock_id, title, link, date, source: source.name });
  }
  return rows;
}
export async function fetchRssNews(id, { stocks, scope, fetcher = fetch, signal, now = Date.now() } = {}) {
  const source = RSS_SOURCES[id]; if (!source) throw fail();
  try {
    const response = await fetcher(source.url, { redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(20000), ...(signal ? [signal] : [])]), headers: { Accept: 'application/rss+xml, application/xml, text/xml' } });
    if (!response.ok || !response.body) throw fail();
    if (Number(response.headers.get('content-length')) > MAX_BYTES) { await response.body.cancel(); throw fail(); }
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_BYTES) { await reader.cancel(); throw fail(); } chunks.push(value); }
    } finally { reader.releaseLock(); }
    return parseRssNews(id, new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)), { stocks, scope, now });
  } catch { throw fail(); }
}
