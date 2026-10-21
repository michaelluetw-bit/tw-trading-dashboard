// 研究名單個股資料更新：依目前資料源的能力逐項取得日成交與還原股價、法人買賣超、營收、估值；
// 取不到的項目保留舊資料並記錄原因；同一天已成功的項目不重抓（可停止後續傳）。
import { data } from './providers/index.mjs';
import { minusDays } from './engine.mjs';
import { t } from './i18n.mjs';

// 各項資料回溯的日曆天數
export const LOOKBACK = { price: 400, adjusted: 400, institutions: 130, revenue: 580, valuation: 30 };

// 依資料源能力組成要抓的項目：{ keys, label, fetch(id, from, to) → rows 或 { key: rows } }
export function defaultSources(opts = {}) {
  const src = [];
  if (data.has('daily')) src.push({ keys: ['price', 'adjusted'], label: 'daily', fetch: (id, from, to) => data.daily(id, from, to, opts) });
  if (data.has('institutional') && data.pick('institutional')?.caps.institutional !== 'bulk') src.push({ keys: ['institutions'], label: 'institutional', fetch: (id, from, to) => data.institutional(id, from, to, opts) });
  if (data.has('revenue')) src.push({ keys: ['revenue'], label: 'revenue', fetch: (id, from, to) => data.revenue(id, from, to, opts) });
  if (data.has('valuation')) src.push({ keys: ['valuation'], label: 'valuation', fetch: (id, from, to) => data.valuation(id, from, to, opts) });
  return src;
}

export async function fetchStock(id, previous = {}, { cutoff, signal, onDataset = () => { }, sources = defaultSources({ signal }) } = {}) {
  const raw = { ...previous, errors: { ...(previous.errors || {}) }, checked: { ...(previous.checked || {}) } };
  for (const s of sources) {
    if (s.keys.every(k => raw.checked[k] === cutoff)) continue;
    onDataset(s.label);
    const from = minusDays(cutoff, Math.max(...s.keys.map(k => LOOKBACK[k] || 400)));
    try {
      const got = await s.fetch(id, from, cutoff);
      const byKey = Array.isArray(got) ? { [s.keys[0]]: got } : got || {};
      for (const key of s.keys) {
        const rows = byKey[key] || [];
        if (rows.length) { raw[key] = rows; raw.checked[key] = cutoff; delete raw.errors[key]; }
        else { if (!raw[key]?.length) raw[key] = []; delete raw.checked[key]; raw.errors[key] = t('本次未回傳資料；既有資料保留原日期'); }
      }
      if(s.keys.includes('adjusted')) {
        if(byKey.adjusted?.length&&byKey.adjustedProvenance)raw.adjustedProvenance=byKey.adjustedProvenance;
        else if(byKey.adjusted?.length)delete raw.adjustedProvenance;
      }
      if (byKey.adjusted?.length) {if (byKey.adjustedIsRaw) raw.adjustedIsRaw = true; else delete raw.adjustedIsRaw;}
    } catch (e) { for (const key of s.keys) raw.errors[key] = e.message; if (e.fatal) { e.partial = raw; e.source = s.label; throw e; } }
  }
  raw.fetchedAt = new Date().toISOString(); return raw;
}

// 法人買賣超只能以「全市場單日」取得的資料源（例如證交所開放資料）：逐日取得近 days 個交易日並存檔（同一天只抓一次），
// 再分配給研究名單個股；回傳 Map(id → rows)。今天的資料公布前不存檔，下次再試。
export const isBulkInstitutional = () => data.has('institutionalAll') && data.pick('institutional')?.caps.institutional === 'bulk';
// 籌碼分數使用近 20 個交易日，取 22 日即可（逐日請求，數量與天數成正比）
export async function bulkInstitutions(ids, cutoff, { signal, days = 22, onProgress = () => { }, store } = {}) {
  const dates = (await data.calendar(minusDays(cutoff, days * 2 + 20), { signal })).filter(d => d <= cutoff).slice(-days);
  const want = new Set(ids), byId = new Map(ids.map(id => [id, []]));
  let done = 0;
  for (const date of dates) {
    if (signal?.aborted) break;
    // store（選用）：get(date, ids) 只在已存的資料涵蓋這些股票時回傳；set 時只存這些股票的列（避免整個市場佔用空間）
    let rows = store?.get(date, want);
    if (!rows) {
      onProgress({ done, total: dates.length, current: date });
      rows = (await data.institutionalAll(date, { signal })).filter(r => want.has(r.stock_id));
      if (rows.length) store?.set(date, rows, want);
    }
    for (const r of rows) if (want.has(r.stock_id)) byId.get(r.stock_id).push(r);
    done++;
  }
  return byId;
}

// 個股近三個日曆日新聞（資料源一次一天）
export async function fetchNews(id, previous = [], { cutoff, signal } = {}) {
  const rows = [...previous];
  for (let i = 0; i < 3; i++) rows.push(...await data.news(id, minusDays(cutoff, i), { signal }));
  return [...new Map(rows.filter(r => String(r.date).slice(0, 10) >= minusDays(cutoff, 90)).map(r => [r.link || r.title, r])).values()];
}
