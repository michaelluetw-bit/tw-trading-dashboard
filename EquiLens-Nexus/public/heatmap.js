// 資金板塊熱浪圖（Squarified Treemap）
// 面積 = 成交金額；顏色 = 漲跌幅（依市場慣例或設定：紅漲綠跌／綠漲紅跌）；板塊依產業別（沒有產業資料時依研究族群）。
import { rotationData, rotationSVG, replayStocks } from './insight-ui.js';
import { heatFeedNotice, currentHeatResponse } from './heat-feed.js';
import * as MK from './market.js';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, n = 0) => v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: n, minimumFractionDigits: n });
const pct = (v, n = 2) => v == null ? '—' : `${v > 0 ? '+' : ''}${fmt(v, n)}%`;
const cls = v => v == null ? 'muted' : v > 0 ? 'up' : v < 0 ? 'down' : 'muted';
const yi = v => v == null ? '—' : fmt(v / 1e8, v >= 1e10 ? 0 : 1);
// 接近漲跌停的門檻（台股 10% 以 9.5% 判定）；沒有漲跌幅限制的市場不標示漲跌停
const LIM = () => { const p = MK.market().limit?.pct; return p ? p * .95 : Infinity; };
const twToday = () => MK.today();

const minusDays = (d, n) => new Date(Date.parse(d) - n * 86400000).toISOString().slice(0, 10);

const H = { data: null, dates: [], market: '全部', focus: null, search: '', selected: null, loading: false, error: '', date: '', fullscreen: false, autoTried: false, loaded: false, live: true, liveBusy: false };
let ctx = null, observer = null, lastAgg = null;
const LIVE_MS = 10000;
let heatRequest = 0;
// 盤中：平日開盤到收盤後數分鐘（與 Nexus 伺服器 liveWindow 相同）。
export function liveOpen(now = new Date()) {
  return MK.isOpen(now.getTime());
}

export function initHeatmap(context) { ctx = context; }
export function heatBusy() { return !!H.loading; }
export function defaultHeatDate() {
  let d = MK.parts().mod >= MK.market().close + 90 ? twToday() : minusDays(twToday(), 1);
  while ([0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay())) d = minusDays(d, 1);
  return d;
}

/* ---------- color ---------- */
const BASE = [26, 36, 52], UP = [236, 30, 66], DOWN = [0, 186, 112], UPMAX = [255, 46, 92], DOWNMAX = [20, 230, 140];
export function heatColor(c) {
  if (c == null) return 'rgb(36,48,68)';
  if (c === 0) return `rgb(${BASE.join(',')})`;
  const limit = Math.abs(c) >= LIM(), t = Math.pow(Math.min(1, Math.abs(c) / 7), 0.72);
  const red = (c > 0) === (MK.upColors().up === '#ff3d5a'); // UP／UPMAX 為紅色系
  const target = red ? (limit ? UPMAX : UP) : (limit ? DOWNMAX : DOWN);
  return `rgb(${BASE.map((b, i) => Math.round(b + (target[i] - b) * t)).join(',')})`;
}

/* ---------- squarified treemap ---------- */
export function squarify(items, x, y, w, h) {
  const out = [], list = items.filter(i => i.value > 0);
  const total = list.reduce((a, i) => a + i.value, 0);
  if (!total || w <= 0 || h <= 0) return out;
  const scale = w * h / total, areas = list.map(i => i.value * scale);
  const worst = (row, side) => { const s = row.reduce((a, b) => a + b, 0), mx = Math.max(...row), mn = Math.min(...row); return Math.max(side * side * mx / (s * s), s * s / (side * side * mn)); };
  let row = [], start = 0, i = 0;
  const layout = () => {
    const s = row.reduce((a, b) => a + b, 0);
    if (w >= h) { const cw = s / h; let yy = y; row.forEach((a, k) => { const hh = a / cw; out.push({ item: list[start + k], x, y: yy, w: cw, h: hh }); yy += hh; }); x += cw; w -= cw; }
    else { const rh = s / w; let xx = x; row.forEach((a, k) => { const ww = a / rh; out.push({ item: list[start + k], x: xx, y, w: ww, h: rh }); xx += ww; }); y += rh; h -= rh; }
    start += row.length; row = [];
  };
  while (i < areas.length) {
    const side = Math.min(w, h), a = areas[i];
    if (!row.length || worst([...row, a], side) <= worst(row, side)) { row.push(a); i++; }
    else layout();
  }
  if (row.length) layout();
  return out;
}

/* ---------- aggregation (client side, supports 上市／上櫃 filter) ---------- */
function aggregate(data, market) {
  const all = data.sectors.flatMap(s => s.stocks).filter(s => market === '全部' || s.market === market);
  const map = new Map();
  for (const s of all) { if (!map.has(s.sector)) map.set(s.sector, []); map.get(s.sector).push(s); }
  const total = all.reduce((a, s) => a + s.money, 0);
  const sectors = [...map].map(([name, stocks]) => {
    stocks.sort((a, b) => b.money - a.money);
    const money = stocks.reduce((a, s) => a + s.money, 0), priced = stocks.filter(s => s.change != null), pm = priced.reduce((a, s) => a + s.money, 0);
    const both = stocks.filter(s => s.prevMoney > 0), now = both.reduce((a, s) => a + s.money, 0), prev = both.reduce((a, s) => a + s.prevMoney, 0);
    return { name, stocks, money, count: stocks.length, share: total ? money / total * 100 : 0, change: pm ? priced.reduce((a, s) => a + s.change * s.money, 0) / pm : null,
      up: priced.filter(s => s.change > 0).length, down: priced.filter(s => s.change < 0).length, flat: priced.filter(s => s.change === 0).length,
      limitUp: priced.filter(s => s.change >= LIM()).length, limitDown: priced.filter(s => s.change <= -LIM()).length,
      moneyChange: prev > 0 ? (now / prev - 1) * 100 : null, moneyDelta: prev > 0 ? now - prev : null };
  }).sort((a, b) => b.money - a.money);
  const priced = all.filter(s => s.change != null), pm = priced.reduce((a, s) => a + s.money, 0);
  const both = all.filter(s => s.prevMoney > 0), now = both.reduce((a, s) => a + s.money, 0), prev = both.reduce((a, s) => a + s.prevMoney, 0);
  return { sectors, stocks: all, byId: new Map(all.map(s => [s.id, s])), total: { money: total, count: all.length, change: pm ? priced.reduce((a, s) => a + s.change * s.money, 0) / pm : null,
    up: priced.filter(s => s.change > 0).length, down: priced.filter(s => s.change < 0).length, flat: priced.filter(s => s.change === 0).length,
    limitUp: priced.filter(s => s.change >= LIM()).length, limitDown: priced.filter(s => s.change <= -LIM()).length, moneyChange: prev > 0 ? (now / prev - 1) * 100 : null } };
}

/* ---------- data ---------- */
export async function loadHeatmap({ date = null, query = false, auto = false } = {}) {
  const request = ++heatRequest; H.feed = null;
  H.loading = request; H.error = ''; H.warn = false; ctx.redraw();
  try {
    const r = query ? await ctx.api('heatmap/query', { date: date || H.date || defaultHeatDate() }) : await ctx.api('heatmap?date=' + encodeURIComponent(date || 'latest'));
    if (request !== heatRequest) return;
    H.dates = r.dates || H.dates;
    if (r.data) { H.data = r.data; H.date = r.data.date; H.focus = H.focus && r.data.sectors.some(s => s.name === H.focus) ? H.focus : null; }
    else if (!query && date) H.error = '此日沒有本機紀錄，請按「查詢 FinMind」。';
    H.loaded = true;
  } catch (e) { if (request !== heatRequest) return; H.error = auto && H.data ? `自動查詢最新交易日未成功（${e.message}）；目前顯示本機紀錄 ${H.data.date}。` : e.message; H.warn = auto && !!H.data; }
  finally { if (H.loading === request) H.loading = false; ctx.redraw(); }
  // 第一次開啟：本機紀錄落後預設交易日時，自動向 FinMind 查詢一次（3 次 API 請求）。
  if (request === heatRequest && !date && !query && !H.autoTried && ctx.state().tokenConfigured && !ctx.state().job.running) {
    H.autoTried = true;
    const want = defaultHeatDate();
    if (!H.data || H.data.date < want && !(H.dates || []).includes(want)) await loadHeatmap({ date: want, query: true, auto: true });
  }
}
// 盤中每 10 秒讀取 Nexus 行情；Shioaji 使用既有推播快取，其餘使用快照。
export async function loadLive() {
  if (H.liveBusy || H.loading || !H.live || !(ctx.state().capabilities?.snapshot || ctx.state().capabilities?.stream === 'shioaji')) return;
  const request = ++heatRequest;
  H.liveBusy = request; H.loaded = true;
  try {
    const r = currentHeatResponse(await ctx.api('heatmap/live'), twToday());
    if (request !== heatRequest || !H.live || H.replay) return;
    H.feed = r.feed || null;
    if (r.feed && !r.data) { H.data = null; H.focus = null; H.error = ''; H.warn = false; }
    if (r.data) { H.data = r.data; H.date = r.data.date; H.focus = H.focus && r.data.sectors.some(s => s.name === H.focus) ? H.focus : null; H.error = ''; H.warn = false; }
  } catch (e) {
    if (request !== heatRequest || !H.live || H.replay) return;
    if (ctx.state().capabilities?.stream === 'shioaji') { H.feed = { ...H.feed, status: 'error' }; H.data = null; }
    H.error = `盤中即時更新失敗：${e.message}`; H.warn = !!H.data;
    if (/權限不足|額度/.test(e.message)) { H.live = false; H.error += '；已暫停自動更新。'; }
  } finally { if (H.liveBusy === request) H.liveBusy = false; ctx.redraw(); }
}
setInterval(() => { if (ctx && H.live && H.loaded && !H.replay && (liveOpen() || H.feed) && !document.hidden && document.getElementById('heatmap')) loadLive(); }, LIVE_MS);

/* ---------- 時光機：回放當日每分鐘畫格 ---------- */
async function openReplay(date) {
  const request = ++heatRequest; H.feed = null; H.live = false; H.loading = false; H.liveBusy = false;
  const { days } = await ctx.api('replay/days'); if (request !== heatRequest) return; if (!days.length) throw new Error('還沒有時光機紀錄。盤中監控開啟後，每分鐘會自動錄製一個畫格。');
  const d = date || days.at(-1), sum = await ctx.api('replay?date=' + d);
  if (request !== heatRequest) return;
  stopPlay(); H.live = false; H.focus = null;
  H.replay = { days, date: d, sum, rot: rotationData(sum), i: sum.times.length - 1, frame: null, playing: false, speed: 1, cache: new Map() };
  await showFrame(H.replay.i);
}
const getFrame = i => { const R = H.replay; if (!R.cache.has(i)) R.cache.set(i, ctx.api(`replay/frame?date=${R.date}&i=${i}`)); return R.cache.get(i); };
async function showFrame(i) {
  const R = H.replay; if (!R) return; R.i = Math.max(0, Math.min(R.sum.times.length - 1, i));
  const f = await getFrame(R.i); if (H.replay !== R) return; R.frame = f;
  for (let k = 1; k <= 3; k++) if (R.i + k < R.sum.times.length) getFrame(R.i + k);
  paint();
}
function paint() { const pc = document.getElementById('pagecontent'); if (!pc || !document.querySelector('.heat-controls')) return ctx.redraw(); pc.innerHTML = heatPage(); mountHeatmap(); }
let playTimer = null;
function stopPlay() { clearInterval(playTimer); playTimer = null; if (H.replay) H.replay.playing = false; }
function startPlay() { const R = H.replay; if (!R) return; if (R.i >= R.sum.times.length - 1) R.i = 0; R.playing = true; clearInterval(playTimer); playTimer = setInterval(() => { if (!H.replay || !R.playing) return stopPlay(); if (R.i >= R.sum.times.length - 1) { stopPlay(); paint(); return; } showFrame(R.i + R.speed); }, 400); paint(); }
function replayView() {
  const R = H.replay, n = R.sum.times.length, agg = R.frame ? aggregate({ sectors: [{ stocks: replayStocks(R.sum, R.frame) }] }, H.market) : null; lastAgg = agg;
  const t = agg?.total, focus = H.focus && agg?.sectors.find(s => s.name === H.focus);
  const controls = `<section class="panel heat-controls rp-controls"><button class="primary" data-rp="play" aria-label="${R.playing ? '暫停' : '播放'}">${R.playing ? '⏸' : '▶'}</button><b class="mono rp-time" id="rp-time">${R.sum.times[R.i]}</b><input type="range" id="rp-slider" min="0" max="${n - 1}" value="${R.i}" aria-label="回放時間"><div class="segmented" role="group" aria-label="播放速度">${[[1, '1×'], [3, '3×'], [10, '10×']].map(([v, l]) => `<button data-rpspeed="${v}" class="${R.speed === v ? 'selected' : ''}">${l}</button>`).join('')}</div><select id="rp-day" aria-label="回放日期">${R.days.slice().reverse().map(d => `<option ${d === R.date ? 'selected' : ''}>${d}</option>`).join('')}</select><div class="segmented" role="group" aria-label="市場">${['全部', ...new Set((H.data?.sectors || []).flatMap(s => s.stocks.map(x => x.market)).filter(Boolean))].map(m => `<button data-heat-market="${m}" class="${H.market === m ? 'selected' : ''}">${m}</button>`).join('')}</div><span class="spacer"></span><button data-rp="close">結束時光機</button></section>`;
  const meta = `<div class="notice"><span>⏱ 時光機 · <b class="mono">${esc(R.date)} ${R.sum.times[R.i]}</b> · 第 ${R.i + 1} / ${n} 個畫格（每分鐘一格）· 面積為開盤至該分鐘的累計成交金額</span><span class="tag cyan">面積＝累計成交 · 顏色＝當下漲跌</span></div>`;
  const kpis = t ? `<section class="stats heat-kpis" style="grid-template-columns:repeat(4,minmax(0,1fr))"><article class="stat"><span class="label">累計成交 <i>TURNOVER</i></span><div class="value glow">${yi(t.money)}<span class="unit">億</span></div></article><article class="stat"><span class="label" title="各股漲跌幅依成交金額加權平均，不是加權指數（加權指數依市值加權）">成交加權漲跌 <i>W-CHG</i></span><div class="value ${cls(t.change)}">${pct(t.change)}</div></article><article class="stat"><span class="label">漲跌家數 <i>BREADTH</i></span><div class="value"><span class="up">${fmt(t.up)}</span><span class="unit">/</span><span class="down">${fmt(t.down)}</span></div></article><article class="stat"><span class="label">漲停／跌停 <i>LIMIT</i></span><div class="value"><span class="up">${fmt(t.limitUp)}</span><span class="unit">/</span><span class="down">${fmt(t.limitDown)}</span></div></article></section>` : '';
  const legend = `<div class="legend">${[-7, -5, -3, -1, 0, 1, 3, 5, 7].map(v => `<span style="background:${heatColor(v)}">${v > 0 ? '+' : ''}${v}</span>`).join('')}</div>`;
  const stage = `<section class="panel heat-stage"><div class="heat-head"><div class="crumbs">${H.focus ? '<button data-heat="back">← 全市場</button>' : ''}<span class="path">REPLAY / ${esc(R.sum.times[R.i])}${focus ? ` / <b>${esc(focus.name)}</b> <span class="${cls(focus.change)}">${pct(focus.change)}</span>` : ` · <b>${agg ? agg.sectors.length : 0}</b> 個板塊`}</span></div><div class="actions">${legend}<button class="ghost" data-heat="fullscreen">⛶</button></div></div><div id="heatmap" class="${H.fullscreen ? 'fullscreen' : ''}" role="img" aria-label="時光機熱浪圖">${agg ? '' : '<div class="hm-empty"><div class="hm-scan"></div><h3>讀取畫格…</h3></div>'}</div></section>`;
  const right = `<aside class="rightcol">${inspector(agg)}<section class="panel"><div class="panelhead"><div><h2><span class="idx">01</span>板塊資金排行</h2><p>${esc(R.sum.times[R.i])} 累計</p></div></div><div class="flow-list">${agg ? sectorRows(agg) : ''}</div></section></aside>`;
  const bottom = `<div class="heat-bottom"><section class="panel"><div class="panelhead"><div><h2><span class="idx">02</span>板塊輪動</h2><p>每 5 分鐘新增成交金額的板塊占比 · 白線為目前時間</p></div></div><div class="contentpad rp-rot">${rotationSVG(R.rot, { w: 900, h: 220, cursor: R.i })}</div></section><section class="panel"><div class="panelhead"><div><h2><span class="idx">03</span>資金焦點個股</h2><p>${esc(R.sum.times[R.i])} 累計</p></div></div>${agg ? movers(agg) : ''}</section></div>`;
  return `${controls}${meta}${kpis}<div class="heat-grid">${stage}${right}</div>${bottom}`;
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-rp],[data-rpspeed]'); if (!b || !ctx || !H.replay) return;
  if (b.dataset.rpspeed) { H.replay.speed = Number(b.dataset.rpspeed); document.querySelectorAll('[data-rpspeed]').forEach(x => x.classList.toggle('selected', x === b)); return; }
  if (b.dataset.rp === 'play') return H.replay.playing ? (stopPlay(), paint()) : startPlay();
  if (b.dataset.rp === 'close') { ++heatRequest; stopPlay(); H.replay = null; H.focus = null; ctx.redraw(); }
});
document.addEventListener('change', async e => { if (e.target.id === 'rp-day' && H.replay) { try { await openReplay(e.target.value); } catch (err) { ctx.toast(err.message); } } });
let slideTimer;
document.addEventListener('input', e => { if (e.target.id !== 'rp-slider' || !H.replay) return; stopPlay(); const i = Number(e.target.value); const t = document.getElementById('rp-time'); if (t) t.textContent = H.replay.sum.times[i]; clearTimeout(slideTimer); slideTimer = setTimeout(() => showFrame(i), 80); });

/* ---------- page ---------- */
export function heatPage() {
  if (H.replay) return replayView();
  const d = H.data, state = ctx.state();
  const agg = d ? aggregate(d, H.market) : null; lastAgg = agg;
  const t = agg?.total;
  const topShare = agg?.sectors[0], inflow = agg?.sectors.filter(s => s.share >= 1 && s.moneyChange != null).sort((a, b) => b.moneyChange - a.moneyChange)[0];
  const date = H.date || d?.date || defaultHeatDate();
  const live = !!d?.live, open = liveOpen();
  const controls = `<section class="panel heat-controls">
    <label>交易日期 <input id="heat-date" type="date" min="2015-01-05" max="${twToday()}" value="${esc(date)}" ${H.loading ? 'disabled' : ''}></label>
    <button class="primary" data-heat="query" ${H.loading || state.job.running ? 'disabled' : ''}>${H.loading ? '<i class="spinner"></i>讀取中' : '⟳ 查詢 FinMind'}</button>
    <button data-heat="live" class="${H.live && open ? 'selected' : ''}" aria-pressed="${H.live}" ${(state.capabilities?.snapshot || state.capabilities?.stream === 'shioaji') ? '' : 'disabled'} title="${MK.market().sessions?.[0]?.[0] || ''}–${MK.market().sessions?.at(-1)?.[1] || ''} 盤中自動更新">${H.liveBusy ? '<i class="spinner"></i>' : H.live && open ? '●' : '○'} 盤中即時${H.live ? (open ? ' · 10 秒' : ' · 未開盤') : ' · 暫停'}</button>
    <button data-heat="replay" title="回放今日或過去每分鐘的資金流向">⏱ 時光機</button>
    ${H.dates.length ? `<select id="heat-cached" aria-label="本機紀錄"><option value="">本機紀錄 ${H.dates.length} 日</option>${H.dates.slice().reverse().map(x => `<option value="${x}" ${x === d?.date ? 'selected' : ''}>${x}</option>`).join('')}</select>` : ''}
    <div class="segmented" role="group" aria-label="市場">${['全部', ...new Set((H.data?.sectors || []).flatMap(s => s.stocks.map(x => x.market)).filter(Boolean))].map(m => `<button data-heat-market="${m}" class="${H.market === m ? 'selected' : ''}" aria-pressed="${H.market === m}">${m}</button>`).join('')}</div>
    <span class="spacer"></span>
    <label>定位 <input id="heat-search" placeholder="代碼／名稱" value="${esc(H.search)}" style="width:130px" autocomplete="off"></label>
    <button data-heat="export" ${d ? '' : 'disabled'}>↓ 板塊 CSV</button>
  </section>`;
  const err = H.error ? `<div class="notice ${H.warn ? 'warn' : 'err'}" role="alert"><span>${esc(H.error)}</span>${state.tokenConfigured ? '' : '<button data-page="settings">連接 FinMind →</button>'}</div>` : '';
  const meta = d?.live ? `<div class="notice"><span><b class="mono">${esc(d.date)}</b> ${!H.live || H.feed && H.feed.status !== 'live' ? '最後收到行情' : open ? '盤中即時' : '盤中最後快照'} · 行情時間 <b class="mono">${esc((d.asOf || d.retrievedAt).slice(11, 19))}</b> · ${d.scope === 'research' ? '研究範圍' : ''}普通股 ${fmt(d.total.count)} 檔 · 成交金額為開盤至今累計${open && H.live ? ` · 每 ${Math.round((d.refreshMs || 10000) / 1000)} 秒自動更新` : ''}</span><span class="tag cyan">面積＝成交金額 · 顏色＝漲跌幅</span></div>`
    : d ? `<div class="notice"><span><b class="mono">${esc(d.date)}</b> 收盤 ·${d.previousDate ? `比較日 <span class="mono">${esc(d.previousDate)}</span> · ` : ''}${d.scope === 'research' ? '研究名單' : ''}普通股 ${fmt(d.total.count)} 檔（已排除 ETF、權證、ETN）· 取得 ${esc(MK.dateTime(d.retrievedAt))}${d.requestedDate && d.requestedDate !== d.date ? ` · 查詢日 ${esc(d.requestedDate)} 非交易日，改用最近交易日` : ''}</span><span class="tag cyan">面積＝成交金額 · 顏色＝漲跌幅</span></div>` : '';
  const kpis = t ? `<section class="stats heat-kpis">
    <article class="stat"><span class="label">總成交金額 <i>TURNOVER</i></span><div class="value glow">${yi(t.money)}<span class="unit">億</span></div><p>${live ? (d?.scope === 'research' ? '研究範圍開盤至今累計' : '開盤至今累計') : `較前一交易日 <span class="${cls(t.moneyChange)} mono">${pct(t.moneyChange, 1)}</span>`}</p></article>
    <article class="stat"><span class="label" title="各股漲跌幅依成交金額加權平均，不是加權指數（加權指數依市值加權）">成交加權漲跌 <i>W-CHG</i></span><div class="value ${cls(t.change)}">${pct(t.change)}</div><p>各股漲跌幅依成交金額加權平均（不是加權指數）</p></article>
    <article class="stat"><span class="label">漲跌家數 <i>BREADTH</i></span><div class="value"><span class="up">${fmt(t.up)}</span><span class="unit">/</span><span class="down">${fmt(t.down)}</span></div><div class="breadth"><i class="u" style="width:${t.up / (t.count || 1) * 100}%"></i><i class="f" style="width:${t.flat / (t.count || 1) * 100}%"></i><i class="d" style="width:${t.down / (t.count || 1) * 100}%"></i></div></article>
    <article class="stat"><span class="label">漲停／跌停 <i>LIMIT</i></span><div class="value"><span class="up">${fmt(t.limitUp)}</span><span class="unit">/</span><span class="down">${fmt(t.limitDown)}</span></div><p>${Number.isFinite(LIM()) ? `漲跌幅 ≥ ${fmt(LIM(), 1)}% 視為觸及` : '此市場沒有漲跌幅限制'}</p></article>
    <article class="stat"><span class="label">資金最集中 <i>FOCUS</i></span><div class="value" style="font-size:1.15rem;font-family:var(--sans)">${esc(topShare?.name || '—')}</div><p><span class="cyan mono">${fmt(topShare?.share, 1)}%</span> 成交占比 · <span class="${cls(topShare?.change)} mono">${pct(topShare?.change)}</span></p></article>
    <article class="stat"><span class="label">資金增溫最多 <i>INFLOW</i></span><div class="value" style="font-size:1.15rem;font-family:var(--sans)">${esc(inflow?.name || '—')}</div><p>成交金額 <span class="${cls(inflow?.moneyChange)} mono">${pct(inflow?.moneyChange, 1)}</span> · 占比 ≥1% 板塊</p></article>
  </section>` : '';
  const legend = `<div class="legend" aria-label="顏色圖例">${[-7, -5, -3, -1, 0, 1, 3, 5, 7].map(v => `<span style="background:${heatColor(v)}">${v > 0 ? '+' : ''}${v}</span>`).join('')}</div>`;
  const focus = H.focus && agg?.sectors.find(s => s.name === H.focus);
  const stage = `<section class="panel heat-stage"><div class="heat-head"><div class="crumbs">${H.focus ? `<button data-heat="back">${d?.scope === 'research' ? '← 研究範圍' : '← 全市場'}</button>` : ''}<span class="path">${d?.scope === 'research' ? 'RESEARCH' : 'MARKET'} / ${H.market === '全部' ? 'ALL' : esc(H.market)}${focus ? ` / <b>${esc(focus.name)}</b> <span class="${cls(focus.change)}">${pct(focus.change)}</span> · ${yi(focus.money)} 億 · ${focus.count} 檔` : ` · <b>${agg ? agg.sectors.length : 0}</b> 個板塊`}</span></div><div class="actions">${legend}<button class="ghost" data-heat="fullscreen" title="全螢幕（Esc 離開）">⛶</button></div></div>
    <div id="heatmap" class="${H.fullscreen ? 'fullscreen' : ''}" role="img" aria-label="資金板塊熱浪圖">${!d ? `<div class="hm-empty">${H.loading ? '<div class="hm-scan"></div><h3>正在掃描全市場成交資料…</h3><p>依序讀取交易日曆、當日與前一交易日行情（3 次 API 請求）</p>' : `<h3>尚無熱浪圖資料</h3><p>選擇交易日期後按「查詢」。收盤資料約於收盤後 1.5 小時公布。</p><div><button class="primary" data-heat="query" ${state.tokenConfigured ? '' : 'disabled'}>⟳ 查詢 FinMind</button></div>`}</div>` : ''}</div></section>`;
  const right = `<aside class="rightcol">${inspector(agg)}<section class="panel"><div class="panelhead"><div><h2><span class="idx">01</span>板塊資金排行</h2><p>依成交金額 · 點擊放大板塊</p></div><span class="tag">${agg ? agg.sectors.length : 0}</span></div><div class="flow-list">${agg ? sectorRows(agg) : '<div class="empty"><p>等待資料</p></div>'}</div></section></aside>`;
  const bottom = agg ? `<div class="heat-bottom"><section class="panel"><div class="panelhead"><div><h2><span class="idx">02</span>板塊資金增減</h2><p>與前一交易日比較（同一批股票）· 單位：億元</p></div></div>${deltaBars(agg)}</section><section class="panel"><div class="panelhead"><div><h2><span class="idx">03</span>資金焦點個股</h2><p>左：成交金額前 10 · 右：成交 ≥ 5 億之漲幅前 10</p></div></div>${movers(agg)}</section></div>` : '';
  return `${controls}${err}${heatFeedNotice(H.feed)}${meta}${kpis}<div class="heat-grid">${stage}${right}</div>${bottom}
  <details class="panel contentpad" style="margin-top:16px"><summary>資料口徑與限制</summary><p>Shioaji 盤中熱浪使用既有訂閱的當日推播快取，範圍只有已訂閱普通股，不代表全市場。</p><p>資料來源為目前資料源的全市場單日成交與股票清單的產業別；資料源沒有全市場行情時，改用研究名單的本機日成交並以研究族群分組。只納入普通股，排除 ETF、ETN、權證、受益憑證與已下市股票；同名產業（如「其他電子業／其他電子類」）合併為同一板塊。</p><p>漲跌幅 = 漲跌價差 ÷（收盤 − 漲跌價差）；板塊漲跌為成交金額加權平均。「資金增減」只比較兩個交易日都有成交的同一批股票；成交金額高代表交投熱絡，不等於資金淨流入或主力買超。</p><p>收盤行情約於收盤後 1.5 小時公布；查詢非交易日會自動改用最近交易日。本頁為研究資訊，非交易建議。</p></details>`;
}

function sectorRows(agg) {
  const max = agg.sectors[0]?.money || 1;
  return agg.sectors.map((s, i) => `<button class="flow-row ${H.focus === s.name ? 'active' : ''}" data-heat-sector="${esc(s.name)}"><span class="rk">${String(i + 1).padStart(2, '0')}</span><span class="nm">${esc(s.name)} <small class="soft">${s.count}</small></span><span class="chg ${cls(s.change)}">${pct(s.change)}</span><span class="bar"><span><i style="width:${Math.max(1, s.money / max * 100)}%"></i></span>${yi(s.money)} 億 · ${fmt(s.share, 1)}%${s.moneyChange != null ? ` · <em class="${cls(s.moneyChange)}" style="font-style:normal">Δ${pct(s.moneyChange, 0)}</em>` : ''}</span></button>`).join('');
}
function deltaBars(agg) {
  const rows = agg.sectors.filter(s => s.moneyDelta != null && s.share >= 0.2);
  if (!rows.length) return `<div class="empty"><p>${H.data?.live ? '盤中累計金額無法與前一交易日全日比較，收盤資料公布後提供。' : '缺少前一交易日資料，無法比較。'}</p></div>`;
  const top = [...rows].sort((a, b) => b.moneyDelta - a.moneyDelta), list = [...top.slice(0, 7), ...top.slice(-7).filter(s => !top.slice(0, 7).includes(s))].sort((a, b) => b.moneyDelta - a.moneyDelta);
  const max = Math.max(...list.map(s => Math.abs(s.moneyDelta)), 1);
  return `<div class="divbars">${list.map(s => `<div class="divbar"><span class="n">${esc(s.name)}</span><span class="l">${s.moneyDelta < 0 ? `<i style="width:${Math.abs(s.moneyDelta) / max * 100}%"></i>` : ''}</span><span class="r">${s.moneyDelta > 0 ? `<i style="width:${s.moneyDelta / max * 100}%"></i>` : ''}</span><span class="v ${s.moneyDelta > 0 ? 'up' : 'down'}">${s.moneyDelta > 0 ? '+' : ''}${fmt(s.moneyDelta / 1e8, 1)}</span></div>`).join('')}</div>`;
}
function movers(agg) {
  const byMoney = [...agg.stocks].sort((a, b) => b.money - a.money).slice(0, 10);
  const strong = agg.stocks.filter(s => s.money >= 5e8 && s.change != null).sort((a, b) => b.change - a.change || b.money - a.money).slice(0, 10);
  const row = (s, v) => `<button class="mover" data-heat-stock="${s.id}"><span>${esc(s.name)} <small class="cyan mono">${s.id}</small></span><span class="${cls(s.change)}">${v}</span></button>`;
  return `<div class="movers"><div><h3>TURNOVER TOP 10</h3>${byMoney.map(s => row(s, `${yi(s.money)}億 ${pct(s.change, 1)}`)).join('')}</div><div><h3>STRONG · ≥5億</h3>${strong.map(s => row(s, pct(s.change))).join('') || '<p class="fine" style="padding:0 16px">無符合個股</p>'}</div></div>`;
}
function inspector(agg) {
  const s = H.selected && agg?.byId.get(H.selected);
  if (!s) return `<section class="panel inspector"><p class="eyebrow">Inspector</p><p class="fine">滑過方塊檢視明細，點擊方塊鎖定個股；點擊板塊標題放大。雙擊個股開啟走勢／五檔。</p></section>`;
  const sector = agg.sectors.find(x => x.name === s.sector), inScope = ctx.inScope(s.id);
  return `<section class="panel inspector"><p class="eyebrow">Locked · ${esc(s.market)}</p><h2>${esc(s.name)} <span class="stockcode">${s.id}</span></h2><div class="big ${cls(s.change)}">${fmt(s.close, 2)} <small>${pct(s.change)}</small></div>
    <dl><dt>產業板塊</dt><dd style="font-family:var(--sans)">${esc(s.sector)}</dd><dt>成交金額</dt><dd>${yi(s.money)} 億</dd><dt>占板塊</dt><dd>${fmt(sector ? s.money / sector.money * 100 : null, 1)}%</dd><dt>成交量</dt><dd>${fmt(s.volume)} ${MK.unit()}</dd><dt>較前日量能</dt><dd class="${cls(s.prevMoney ? s.money / s.prevMoney - 1 : null)}">${s.prevMoney ? pct((s.money / s.prevMoney - 1) * 100, 0) : '—'}</dd><dt>開／高／低</dt><dd>${fmt(s.open, 2)} / ${fmt(s.high, 2)} / ${fmt(s.low, 2)}</dd></dl>
    <div class="actions" style="margin-top:12px"><button class="primary" data-stock="${s.id}">走勢／五檔 ↗</button>${inScope ? `<button data-stock-detail="${s.id}">個股診斷</button>` : ''}<button data-heat-sector="${esc(s.sector)}">放大板塊</button></div></section>`;
}

/* ---------- treemap render ---------- */
export function mountHeatmap() {
  const el = document.getElementById('heatmap');
  if (!el) { observer?.disconnect(); observer = null; return; }
  if (!H.replay) {
    if (!H.loaded && !H.loading) { loadHeatmap().then(() => { if (H.live && liveOpen()) loadLive(); }); return; }
    if (!H.data) return;
  } else if (!lastAgg) return;
  renderTreemap(el);
  observer?.disconnect();
  let pending;
  observer = new ResizeObserver(() => { cancelAnimationFrame(pending); pending = requestAnimationFrame(() => document.getElementById('heatmap') && renderTreemap(document.getElementById('heatmap'))); });
  observer.observe(el);
}
function renderTreemap(el) {
  const agg = lastAgg; if (!agg) return;
  const W = el.clientWidth, Ht = el.clientHeight; if (W < 10 || Ht < 10) return;
  const sectors = H.focus ? agg.sectors.filter(s => s.name === H.focus) : agg.sectors;
  const q = H.search.trim();
  const hits = q ? new Set(agg.stocks.filter(s => s.id === q || s.id.startsWith(q) && q.length >= 2 || s.name.includes(q)).map(s => s.id)) : null;
  let html = '';
  for (const r of squarify(sectors.map(s => ({ value: s.money, s })), 0, 0, W, Ht)) {
    const s = r.item.s, big = r.w > 58 && r.h > 38, head = big ? 19 : 0;
    html += `<div class="hm-sector" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px">`;
    if (head) html += `<header data-hm-sector="${esc(s.name)}" title="${esc(s.name)}：${yi(s.money)} 億，${pct(s.change)}"><b>${esc(s.name)}</b><i class="${cls(s.change)}">${r.w > 150 ? `${fmt(s.share, 1)}% · ` : ''}${pct(s.change)}</i></header>`;
    if (r.w * r.h < 700 && !H.focus) { html += `<div class="hm-tile" data-hm-sector="${esc(s.name)}" style="left:0;top:0;width:100%;height:100%;background:${heatColor(s.change)}" title="${esc(s.name)}"></div></div>`; continue; }
    for (const t of squarify(s.stocks.map(st => ({ value: st.money, st })), 0, head, r.w - 2, r.h - 2 - head)) html += tile(t, hits);
    html += '</div>';
  }
  el.innerHTML = html;
}
function tile(t, hits) {
  const s = t.item.st, w = t.w, h = t.h, limitUp = s.change >= LIM(), limitDown = s.change <= -LIM();
  let fs = Math.max(9, Math.min(24, Math.sqrt(w * h) / 5.4));
  const units = [...s.name].reduce((a, c) => a + (/[\x00-\x7f]/.test(c) ? .58 : 1), 0);
  const fitName = Math.min(fs, (w - 6) / units);
  let label = '';
  if (fitName >= 10 && h >= fitName * 1.25) { fs = fitName; label = s.name; }
  else if (w >= fs * 2.6 && h >= fs * 1.2) label = s.id;
  let inner = '';
  if (label) {
    inner += `<b style="font-size:${fs}px">${esc(label)}</b>`;
    if (h >= fs * 2.4 && w >= fs * 3) inner += `<em style="font-size:${Math.max(9, fs * .78)}px">${pct(s.change)}</em>`;
    if (h >= fs * 3.8 && w >= fs * 4.2) inner += `<small style="font-size:${Math.max(9, fs * .62)}px">${yi(s.money)}億</small>`;
  }
  if ((limitUp || limitDown) && w > 34 && h > 26) inner += `<span class="lim">${limitUp ? '漲停' : '跌停'}</span>`;
  const k = [limitUp ? 'limit-up' : '', limitDown ? 'limit-down' : '', hits ? (hits.has(s.id) ? 'hit' : 'dim') : ''].join(' ');
  return `<div class="hm-tile ${k}" data-hm-stock="${s.id}" style="left:${t.x}px;top:${t.y}px;width:${w}px;height:${h}px;background:${heatColor(s.change)}">${inner}</div>`;
}

/* ---------- tooltip & events ---------- */
function tip() { let t = document.querySelector('.hm-tip'); if (!t) { t = document.createElement('div'); t.className = 'hm-tip'; document.body.append(t); } return t; }
function hideTip() { document.querySelector('.hm-tip')?.classList.remove('show'); }
document.addEventListener('mousemove', e => {
  const target = e.target.closest?.('[data-hm-stock],[data-hm-sector]');
  if (!target || !target.closest('#heatmap') || !lastAgg) { hideTip(); return; }
  const t = tip();
  if (target.dataset.hmStock) {
    const s = lastAgg.byId.get(target.dataset.hmStock); if (!s) return hideTip();
    const sec = lastAgg.sectors.find(x => x.name === s.sector);
    t.innerHTML = `<h4>${esc(s.name)} <span>${s.id} · ${esc(s.market)}</span></h4><dl><dt>收盤</dt><dd>${fmt(s.close, 2)}</dd><dt>漲跌幅</dt><dd class="${cls(s.change)}">${pct(s.change)}</dd><dt>成交金額</dt><dd>${yi(s.money)} 億</dd><dt>板塊占比</dt><dd>${fmt(sec ? s.money / sec.money * 100 : null, 1)}%</dd><dt>成交量</dt><dd>${fmt(s.volume)} ${MK.unit()}</dd><dt>量能較前日</dt><dd class="${cls(s.prevMoney ? s.money - s.prevMoney : null)}">${s.prevMoney ? pct((s.money / s.prevMoney - 1) * 100, 0) : '—'}</dd><dt>板塊</dt><dd style="font-family:var(--sans)">${esc(s.sector)}</dd></dl>`;
  } else {
    const s = lastAgg.sectors.find(x => x.name === target.dataset.hmSector); if (!s) return hideTip();
    t.innerHTML = `<h4>${esc(s.name)} <span>${s.count} 檔</span></h4><dl><dt>成交金額</dt><dd>${yi(s.money)} 億</dd><dt>${H.data?.scope === 'research' ? '研究範圍占比' : '市場占比'}</dt><dd>${fmt(s.share, 1)}%</dd><dt>成交加權漲跌</dt><dd class="${cls(s.change)}">${pct(s.change)}</dd><dt>漲／跌／平</dt><dd><span class="up">${s.up}</span> / <span class="down">${s.down}</span> / ${s.flat}</dd><dt>漲停／跌停</dt><dd>${s.limitUp} / ${s.limitDown}</dd><dt>資金較前日</dt><dd class="${cls(s.moneyChange)}">${pct(s.moneyChange, 1)}</dd></dl>`;
  }
  t.classList.add('show');
  const r = t.getBoundingClientRect(), x = e.clientX + 16 + r.width > innerWidth ? e.clientX - r.width - 14 : e.clientX + 16, y = e.clientY + 16 + r.height > innerHeight ? e.clientY - r.height - 12 : e.clientY + 16;
  t.style.left = x + 'px'; t.style.top = y + 'px';
});
document.addEventListener('mouseleave', hideTip);
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-heat],[data-heat-market],[data-heat-sector],[data-hm-sector],[data-hm-stock],[data-heat-stock]');
  if (!el || !ctx) return;
  if (el.dataset.hmStock || el.dataset.heatStock) { const id = el.dataset.hmStock || el.dataset.heatStock; H.selected = H.selected === id && el.dataset.hmStock ? null : id; if (el.dataset.heatStock) { const s = lastAgg?.byId.get(id); if (s && H.focus && H.focus !== s.sector) H.focus = s.sector; } ctx.redraw(); return; }
  if (el.dataset.hmSector || el.dataset.heatSector) { const name = el.dataset.hmSector || el.dataset.heatSector; H.focus = H.focus === name && el.dataset.heatSector ? null : name; hideTip(); ctx.redraw(); return; }
  if (el.dataset.heatMarket) { H.market = el.dataset.heatMarket; H.focus = null; ctx.redraw(); return; }
  const a = el.dataset.heat;
  if (a === 'query') { H.live = false; H.date = document.getElementById('heat-date')?.value || H.date || defaultHeatDate(); await loadHeatmap({ date: H.date, query: true }); if (H.data && !H.error) ctx.toast(`已更新 ${H.data.date} 資金板塊熱浪圖（盤中即時已暫停）`); }
  else if (a === 'replay') { el.disabled = true; try { await openReplay(); } catch (err) { ctx.toast(err.message); el.disabled = false; } }
  else if (a === 'live') { ++heatRequest; H.loading = false; H.liveBusy = false; H.live = !H.live; if (H.feed) H.feed = { ...H.feed, status: H.live ? 'waiting' : 'display-paused' }; H.error = ''; ctx.redraw(); if (H.live && liveOpen()) loadLive(); else if (H.live) ctx.toast(`目前非盤中，開盤後（平日 ${MK.market().sessions?.[0]?.[0] || ''}）自動更新`); }
  else if (a === 'back') { H.focus = null; ctx.redraw(); }
  else if (a === 'fullscreen') { H.fullscreen = !H.fullscreen; ctx.redraw(); }
  else if (a === 'export') exportCSV();
});
document.addEventListener('dblclick', e => { const el = e.target.closest('[data-hm-stock]'); if (el) ctx.openStock(el.dataset.hmStock); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && H.fullscreen) { H.fullscreen = false; ctx.redraw(); } });
document.addEventListener('change', e => {
  if (e.target.id === 'heat-date') { H.date = e.target.value; }
  if (e.target.id === 'heat-cached' && e.target.value) { H.focus = null; H.live = false; loadHeatmap({ date: e.target.value }); }
});
let searchTimer;
document.addEventListener('input', e => {
  if (e.target.id !== 'heat-search') return;
  H.search = e.target.value.trim(); clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const q = H.search, hit = q && lastAgg?.stocks.find(s => s.id === q || s.name === q);
    if (hit) { H.selected = hit.id; if (H.focus && H.focus !== hit.sector) H.focus = hit.sector; ctx.redraw(); document.getElementById('heat-search')?.focus(); }
    else { const el = document.getElementById('heatmap'); if (el) renderTreemap(el); }
  }, 160);
});
function exportCSV() {
  if (!lastAgg || !H.data) return;
  const safe = v => `"${String(v ?? '').replace(/^[=+@\-]/, "'$&").replace(/"/g, '""')}"`;
  const rows = [['日期', '市場', '板塊', '檔數', '成交金額(億)', '成交占比%', '成交加權漲跌%', '上漲', '下跌', '平盤', '漲停', '跌停', '資金較前日%'],
    ...lastAgg.sectors.map(s => [H.data.date, H.market, s.name, s.count, (s.money / 1e8).toFixed(2), s.share.toFixed(2), s.change?.toFixed(2), s.up, s.down, s.flat, s.limitUp, s.limitDown, s.moneyChange?.toFixed(1)])];
  const url = URL.createObjectURL(new Blob(['﻿' + rows.map(r => r.map(safe).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = `Nexus-資金板塊-${H.data.date}-${H.market}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  ctx.toast(`已匯出 ${lastAgg.sectors.length} 個板塊`);
}
