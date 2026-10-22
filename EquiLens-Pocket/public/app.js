import { heatFeedNotice, currentHeatResponse } from './heat-feed.js';
import { aggregate, renderTreemap, heatColor } from './heatmap.js';
import { renderFlowCards, downloadFlowCard } from './flow-cards.js';
import { initChips, loadChips, brokersView, holdersView } from './chips.js';
import { initLive, livePage, loadLiveTab, reportCard, replayActive, replayPage, mountReplay, stockExtrasShell, fillStockExtras, liveState, newsSettingsCard, IOS, rulesCard, openQuote, openIndex } from './live.js';
import { setLanguage, getLanguage, tx } from './i18n.js';
import * as MK from './market.js';

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, n = 0) => v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: n, minimumFractionDigits: n });
const pct = (v, n = 2) => v == null ? '—' : `${v > 0 ? '+' : ''}${fmt(v, n)}%`;
const sign = (v, n = 0) => v == null ? '—' : `${v > 0 ? '+' : ''}${fmt(v, n)}`;
const cls = v => v == null || v === 0 ? 'muted' : v > 0 ? 'up' : 'down';
const yi = v => v == null ? '—' : fmt(v / 1e8, Math.abs(v) >= 1e10 ? 0 : 1);
const twToday = () => MK.today();
const minusDays = (d, n) => new Date(Date.parse(d) - n * 864e5).toISOString().slice(0, 10);
const FACTORS = [['technical', '技術'], ['chips', '籌碼'], ['topic', '話題'], ['industry', '行業']];
const TABS = [
  ['brief', '焦點', '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'],
  ['home', '盤勢', '<path d="M3 12l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>'],
  ['heat', '熱浪', '<rect x="3" y="3" width="10" height="11" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="15" y="11" width="6" height="10" rx="1"/><rect x="3" y="16" width="10" height="5" rx="1"/>'],
  ['live', '盤中', '<circle cx="12" cy="12" r="9"/><path d="M12 12l6-4"/><circle cx="12" cy="12" r="4.5" opacity=".6"/><circle cx="12" cy="12" r="1.2"/>'],
  ['stocks', '個股', '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>'],
  ['patterns', '型態', '<path d="M3 17l5-6 4 3 4-8 5 5"/>'],
  ['flows', '籌碼', '<path d="M4 8h14l-3-3M20 16H6l3 3"/>'],
];
// 法人籌碼分頁只在台股 FinMind 可用時顯示
const tabsNow = () => TABS.filter(([k]) => k !== 'flows' || !S.profile || !!S.profile.capabilities?.flows);
const TITLES = { brief: '今日焦點', home: '今日盤勢', heat: '資金熱浪', live: '盤中雷達', stocks: '個股研究', patterns: '型態選股', flows: '法人籌碼' };

const S = { tab: 'brief', brief: { news: { 0: null, 1: null }, offset: 0, section: 'all', limit: 15, week: null, kind: 'all' }, summary: null, stocks: null, heat: { data: null, dates: [], market: '全部', focus: null, sel: null, loading: false, error: '', tried: false, live: true, liveBusy: false }, pat: null, patStatus: '', patCat: '', patLimit: 20,
  list: { mode: 'watch', group: '', sort: 'score', q: '', limit: 40 }, moverSide: 'up', flows: { view: 'inst', data: null, date: '', loading: false, error: '', market: '上市', inv: 'total', side: 'buy', contract: null, page: 0 }, loading: false };

/* ---------- theme ---------- */
function applyTheme() { let t = null; try { t = localStorage.getItem('pocket.theme'); } catch { } if (!t) t = 'dark'; /* 預設深色主題（可在設定或右上角切換） */ document.documentElement.dataset.theme = t; document.querySelector('meta[name=theme-color]')?.setAttribute('content', t === 'light' ? '#f2f5f9' : '#070b14'); }
applyTheme();
/* ---------- 字型大小（存在這支手機） ---------- */
const FONT_SIZES = [[14, '小'], [16, '標準'], [18, '大'], [20, '特大']];
function fontSize() { let v = 16; try { v = Number(localStorage.getItem('pocket.font')) || 16; } catch { } return FONT_SIZES.some(([s]) => s === v) ? v : 16; }
function applyFont() { document.documentElement.style.fontSize = `${fontSize()}px`; }
applyFont();

/* ---------- api ---------- */
async function api(path, body) {
  let res;
  try { res = await fetch('/m/' + path, body === undefined ? { credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'nexus-pocket' }, body: JSON.stringify(body) }); }
  catch { throw new Error('網路連線中斷，請確認網路後重試'); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.login) { showLogin(); throw Object.assign(new Error(data.error), { silent: true }); }
  if (res.status === 503 && data.setup) { showSetup(data.error); throw Object.assign(new Error(data.error), { silent: true }); }
  if (!res.ok) throw new Error(data.error || '讀取失敗');
  return data;
}
let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200); }

/* ---------- market status ---------- */
function market() {
  const [label, k] = MK.status(); // 研究市場的當地時間與交易時段
  return label === '盤中 LIVE' ? ['盤中', 'live'] : [label, k === 'off' ? '' : k];
}
function defaultHeatDate() { let d = MK.parts().mod >= MK.market().close + 90 ? twToday() : minusDays(twToday(), 1); while ([0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay())) d = minusDays(d, 1); return d; }

/* ---------- shell ---------- */
const ICON = { menu: '<path d="M4 6.5h16M4 12h16M4 17.5h16"/>', refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>', theme: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>', back: '<path d="M15 18l-6-6 6-6"/>', close: '<path d="M6 6l12 12M18 6L6 18"/>' };
const svg = p => `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
function shell() {
  document.body.innerHTML = `<header class="appbar"><button class="iconbtn menu" id="settings" aria-label="設定">${svg(ICON.menu)}</button><h1 id="title"></h1><button class="iconbtn" id="refresh" aria-label="重新整理">${svg(ICON.refresh)}</button><button class="iconbtn" id="theme" aria-label="切換深淺色">${svg(ICON.theme)}</button></header>
  <main id="main"></main>
  <nav class="tabbar" aria-label="主要分頁">${tabsNow().map(([k, l, i]) => `<button class="tab" data-tab="${k}" aria-label="${l}">${svg(i)}<span>${l}</span></button>`).join('')}</nav>
  <div class="sheet-backdrop" id="backdrop"></div><section class="sheet" id="sheet" role="dialog" aria-modal="true"><div class="grab"></div><div class="sheet-h"><h2 id="sheet-title"></h2><button class="iconbtn" data-close-sheet aria-label="關閉">${svg(ICON.close)}</button></div><div class="sheet-b" id="sheet-body"></div></section>
  <div id="toast" role="status" aria-live="polite"></div>`;
}
function setTab(tab, push = true) {
  S.tab = tabsNow().some(t => t[0] === tab) ? tab : 'brief';
  if (push) history.pushState({ tab: S.tab }, '', '#' + S.tab);
  document.querySelectorAll('.tab').forEach(b => { b.classList.toggle('active', b.dataset.tab === S.tab); b.setAttribute('aria-current', b.dataset.tab === S.tab ? 'page' : 'false'); });
  $('#title').innerHTML = `${TITLES[S.tab]}`;
  window.scrollTo(0, 0);
  draw(); load();
}
function draw() {
  const main = $('#main'); if (!main) return;
  main.innerHTML = jobBar() + ({ brief: briefPage, home: homePage, heat: () => replayActive() ? replayPage() : heatPage(), live: livePage, stocks: stocksPage, patterns: patternPage, flows: flowPage })[S.tab]();
  if (S.tab === 'heat') replayActive() ? mountReplay() : mountHeat();
}
async function load(force = false) {
  const btn = $('#refresh'); btn?.classList.add('spin');
  if (!jobTimer) pollJob();
  try {
    if (S.tab === 'brief') { await loadBrief(force); if (!S.stocks) loadStocks(S.tab === 'brief').catch(() => { }); }
    else if (S.tab === 'home') { S.summary = await api('api/summary'); if (!S.stocks) loadStocks(); }
    else if (S.tab === 'stocks') await loadStocks(true);
    else if (S.tab === 'heat') { if (replayActive()) return; if (!S.heat.data || force) await loadHeat(); if (S.heat.live && liveOpen()) await loadLive(); if (!S.stocks) loadStocks(); }
    else if (S.tab === 'live') { await loadLiveTab(); if (!S.stocks) loadStocks(); }
    else if (S.tab === 'patterns') { if (!S.pat || force) S.pat = await api('api/patterns'); }
    else if (S.tab === 'flows') { if (S.flows.view !== 'inst') await loadChips(force); else if (!S.flows.data || force) await loadFlows(); }
    S.error = '';
  } catch (e) { if (!e.silent) { S.error = e.message; } }
  finally { btn?.classList.remove('spin'); draw(); }
}
async function loadStocks(render = false) { S.stocks = await api('api/stocks'); S.stocksAt = Date.now(); if (render) draw(); }
// 開啟個股／型態頁時：清單超過 20 秒就重新取得，讓電腦版剛新增的自選分組與研究族群出現在選單中
function refreshWatchSel(id, name) { if (S.stocks && Date.now() - (S.stocksAt || 0) < 20e3) return; loadStocks().then(() => syncWatchSel(id, name)).catch(() => { }); }

/* ---------- 手機端觸發資料更新＋進度 ---------- */
let jobTimer = null;
const jobBar = () => { const j = S.job; if (!j?.running) return '<div id="jobbar"></div>'; const w = j.total ? Math.round(j.done / j.total * 100) : 0;
  return `<div id="jobbar" class="jobbar"><div class="jb-t"><span class="spinner"></span><span>${esc(j.message || '電腦更新中…')}</span><button class="btn" data-job-cancel>停止</button></div>${j.total ? `<div class="jb-p"><i style="width:${w}%"></i></div><small class="num">${j.done}/${j.total}${j.errors ? ` · ${j.errors} 項未取得` : ''}</small>` : ''}</div>`; };
async function pollJob() {
  let j; try { j = await api('api/job'); } catch { return; }
  const was = S.job?.running; S.job = j;
  const bar = $('#jobbar'); if (bar) bar.outerHTML = jobBar();
  if (j.running && !jobTimer) jobTimer = setInterval(pollJob, 2000);
  if (!j.running && jobTimer) { clearInterval(jobTimer); jobTimer = null; }
  if (was && !j.running) {
    toast(j.message || '更新完成');
    S.summary = null; S.stocks = null; S.pat = null;
    if (['home', 'stocks', 'patterns'].includes(S.tab)) load();
    if (S.sheetStock && $('#sheet')?.classList.contains('open')) openStock(S.sheetStock.id);
  }
}
async function startJob(path, body, label) {
  try { await api(path, body); toast(`已開始：${label}`); S.job = { running: true, message: label, done: 0, total: 0 }; const bar = $('#jobbar'); if (bar) bar.outerHTML = jobBar(); pollJob(); }
  catch (e) { if (!e.silent) toast(e.message); }
}
const updBtns = (watchN, allN) => `<div class="upd-row"><button class="btn" data-upd="watchlist" ${watchN ? '' : 'disabled'}>⟳ 更新自選 ${watchN} 檔</button><button class="btn" data-upd="all">⟳ 更新研究名單${allN ? ` ${allN} 檔` : ''}</button></div>`;
const inScope = id => !!S.stocks?.stocks.some(s => s.id === id);
const errBox = () => S.error ? `<div class="notice err">${esc(S.error)}${/Nexus/.test(S.error) ? '<br><small>請確認電腦開機，且「衡析 Nexus」服務正在執行。</small>' : ''}</div>` : '';
const loadingBox = () => `<div class="empty"><span class="spinner"></span> 讀取中…</div>`;

/* ---------- common rows ---------- */
function spark(v) { if (!v?.length) return ''; const mn = Math.min(...v), mx = Math.max(...v), r = mx - mn || 1, up = v.at(-1) >= v[0]; return `<svg class="spark" viewBox="0 0 56 24" aria-hidden="true"><polyline fill="none" stroke="${up ? 'var(--up)' : 'var(--down)'}" stroke-width="1.6" points="${v.map((x, i) => `${i / (v.length - 1 || 1) * 54 + 1},${22 - (x - mn) / r * 20}`).join(' ')}"/></svg>`; }
const scoreBadge = s => `<span class="score ${s == null ? '' : s >= 75 ? 'hi' : s >= 55 ? 'mid' : ''}">${s == null ? '—' : fmt(s)}</span>`;
function stockRow(s, { showSpark = false } = {}) {
  return `<button class="row" data-stock="${s.id}"><span class="nm">${esc(s.name)}<small>${s.id}</small></span><span class="sub">${esc(s.groups?.slice(0, 2).join('・') || s.sector || '')}${s.asOf ? ` · ${s.asOf.slice(5)}` : ''}</span><span class="rt">${showSpark ? spark(s.spark) : ''}<span class="pc"><span class="px num">${fmt(s.price, 2)}</span><span class="chg num ${cls(s.change)}">${pct(s.change)}</span></span>${scoreBadge(s.score)}</span></button>`;
}
function barRow(name, value, width, meta = '', attr = '') { return `<button class="barrow" ${attr}><span class="n">${esc(name)}</span><span class="v num">${value}</span><span class="track"><i style="width:${Math.max(2, Math.min(100, width))}%"></i></span>${meta ? `<span class="meta">${meta}</span>` : ''}</button>`; }

/* ---------- brief：盤前焦點新聞＋本周大事紀（資料經 Nexus 取得） ---------- */
const BSEC = [['all', '全部'], ['must', '必讀'], ['tw', '台股'], ['us', '美股'], ['global', '國際'], ['commodity', '原物料・匯率'], ['other', '其他']];
const tparts = ms => MK.parts(ms);
const thm = ms => { const p = tparts(ms); return `${p.hour}:${p.minute}`; };
const tmdhm = ms => { const p = tparts(ms); return `${Number(p.month)}/${Number(p.day)} ${p.hour}:${p.minute}`; };
// 中文介面才顯示中文星期與中文對照名稱；其他語言顯示原文
const zhUI = () => MK.lang() === 'zh-TW';
const dayLbl = d => { const x = new Date(`${d}T00:00:00Z`); return zhUI() ? `${x.getUTCMonth() + 1}/${x.getUTCDate()}（${'日一二三四五六'[x.getUTCDay()]}）` : `${x.getUTCMonth() + 1}/${x.getUTCDate()} (${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][x.getUTCDay()]})`; };
const winLbl = ms => { const p = tparts(ms); return `${dayLbl(`${p.year}-${p.month}-${p.day}`)} ${p.hour}:${p.minute}`; };
async function loadBrief(force = false) {
  const B = S.brief, o = B.offset, r = force ? '&refresh=1' : '';
  const [n, w] = await Promise.allSettled([api(`api/briefing/news?offset=${o}${r}`), api(`api/briefing/week${force ? '?refresh=1' : ''}`)]);
  if (n.status === 'fulfilled') B.news[o] = n.value; if (w.status === 'fulfilled') B.week = w.value;
  const bad = [n, w].find(x => x.status === 'rejected'); if (bad && !bad.reason?.silent) throw bad.reason;
}
function briefPage() {
  const B = S.brief, [ml, mk] = market();
  if (!B.news[B.offset] && !B.week) return errBox() + loadingBox();
  return `<div class="statusline"><span class="pill"><span class="dot ${mk}"></span>${ml}</span><span class="pill">${dayLbl(twToday())}</span></div>${errBox()}${reportCard()}${MK.market().id === 'TW' || zhUI() ? briefNews() : ''}${briefWeek()}
  <div class="foot">新聞：鉅亨網頭條 · 行事曆：Forex Factory、Nasdaq<br>時間皆為台北時間 · 研究資訊，非交易建議</div>`;
}
function briefNews() {
  const B = S.brief, n = B.news[B.offset], w = n?.window, items = n?.items || [];
  const cnt = k => k === 'all' ? items.length : k === 'must' ? items.filter(i => i.must).length : items.filter(i => i.section === k).length;
  const list = B.section === 'all' ? items : B.section === 'must' ? items.filter(i => i.must) : items.filter(i => i.section === B.section);
  const head = `<div class="card-h"><h2>盤前焦點新聞<small>${items.length ? items.length + ' 則' : ''}</small></h2>${w ? `<span class="pill ${w.inProgress ? 'warn' : ''}">${w.inProgress ? '彙整中' : '已收齊'}</span>` : ''}</div>`;
  const ctrl = `<div class="card-b">${w ? `<p class="bf-win num">${winLbl(w.start)} → ${winLbl(w.end)}</p>` : ''}<div class="seg" role="group" aria-label="新聞期間">${[[0, '本期'], [1, '上一期']].map(([v, l]) => `<button class="${B.offset === v ? 'on' : ''}" data-boff="${v}">${l}</button>`).join('')}</div>
    ${items.length ? `<div class="bf-chips" role="group" aria-label="新聞分類">${BSEC.filter(([k]) => cnt(k)).map(([k, l]) => `<button class="${B.section === k ? 'on' : ''}" data-bsec="${k}">${l}<b>${cnt(k)}</b></button>`).join('')}</div>` : ''}</div>`;
  if (!n) return `<section class="card">${head}${ctrl}${loadingBox()}</section>`;
  const body = list.slice(0, B.limit).map(i => {
    const tw = i.tw.map(id => { const s = S.stocks?.stocks.find(x => x.id === id); return s ? `<button class="bf-chip in" data-stock="${esc(id)}">${esc(s.name)} ${esc(id)}</button>` : `<button class="bf-chip" data-stock="${esc(id)}">${esc(id)}</button>`; });
    const us = i.us.map(u => `<span class="bf-chip us">${esc(u.name)}</span>`);
    return `<article class="bf-item ${i.must ? 'must' : ''}"><div class="bf-meta"><span class="num">${tmdhm(i.time)}</span><span class="bf-cat">${esc(i.category)}</span>${i.must ? '<span class="bf-must">必讀</span>' : ''}</div>
    <a class="bf-title" href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">${esc(i.title)}</a>${i.summary ? `<p class="bf-sum">${esc(i.summary)}</p>` : ''}${tw.length || us.length ? `<div class="bf-tags">${[...tw, ...us].join('')}</div>` : ''}</article>`;
  }).join('');
  const more = list.length > B.limit ? `<button class="btn bf-more" data-bmore>顯示更多（還有 ${list.length - B.limit} 則）</button>` : '';
  return `<section class="card">${head}${ctrl}${n.error ? `<div class="notice ${items.length ? 'warn' : 'err'} bf-note">${esc(n.error)}</div>` : ''}${body || `<div class="empty">${w?.inProgress ? '這一期的新聞會在台股收盤後陸續出現。' : '這段期間沒有焦點新聞。'}</div>`}${more}<p class="bf-src">鉅亨網頭條 · 取得 ${tmdhm(n.fetchedAt)}</p></section>`;
}
function briefWeek() {
  const B = S.brief, w = B.week, today = twToday(), now = Date.now();
  const head = `<div class="card-h"><h2>本周大事紀<small>${w?.range ? `${dayLbl(w.range.start)}–${dayLbl(w.range.end)}` : ''}</small></h2></div>`;
  if (!w?.range) return `<section class="card">${head}${w?.errors?.length ? `<div class="notice err bf-note">${esc(w.errors.join('；'))}</div>` : loadingBox()}</section>`;
  const macro = B.kind === 'earnings' ? [] : w.macro, earn = B.kind === 'macro' ? [] : w.earnings;
  const next = w.macro.find(e => !e.holiday && e.time > now);
  const days = w.range.days.map(d => ({ d, m: macro.filter(e => e.date === d), e: earn.filter(e => e.date === d) })).filter(x => x.m.length || x.e.length);
  const mrow = e => `<div class="ev ${e.impact === 'High' ? 'hi' : ''} ${!e.holiday && e.time < now ? 'done' : ''} ${e === next ? 'next' : ''}"><span class="ev-t num">${e.holiday ? '全天' : thm(e.time)}</span><div class="ev-b"><b><span class="ev-f">${esc(e.countryName)}</span><span translate="no">${esc(zhUI() ? e.title : e.titleEn || e.title)}</span>${e.impact === 'High' ? '<span class="ev-hi">高</span>' : ''}</b>${e.forecast || e.previous ? `<small class="num">${[e.forecast && '預估 ' + esc(e.forecast), e.previous && '前值 ' + esc(e.previous)].filter(Boolean).join(' · ')}</small>` : ''}</div></div>`;
  const erow = e => `<div class="ev earn"><span class="ev-t">${esc(e.timing)}</span><div class="ev-b"><b><span class="ev-f earn">財報</span><span translate="no">${esc(zhUI() && e.zh || e.name)}</span> <span class="num">${esc(e.symbol)}</span></b><small>${[e.eps && tx('EPS 預估') + ' ' + e.eps, e.timing === '盤前' ? '台灣當晚' : e.timing === '盤後' ? '台灣隔日清晨' : ''].filter(Boolean).map(esc).join(' · ')}</small></div></div>`;
  return `<section class="card">${head}<div class="card-b"><div class="seg" role="group" aria-label="事件類型">${[['all', '全部'], ['macro', '經濟數據'], ['earnings', '財報']].map(([v, l]) => `<button class="${B.kind === v ? 'on' : ''}" data-bkind="${v}">${l}</button>`).join('')}</div>
    ${next && B.kind !== 'earnings' ? `<div class="bf-next"><span>下一個數據</span><b class="num">${dayLbl(next.date)} ${thm(next.time)}</b><em>${esc(next.countryName)} · ${esc(next.title)}</em></div>` : ''}</div>
    ${(w.errors || []).map(e => `<div class="notice warn bf-note">${esc(e)}</div>`).join('')}
    ${days.map(({ d, m, e }) => `<div class="wk ${d < today ? 'past' : ''} ${d === today ? 'today' : ''}"><h3>${dayLbl(d)}${d === today ? '<span class="pill">今天</span>' : ''}</h3>${m.map(mrow).join('')}${e.map(erow).join('')}</div>`).join('') || '<div class="empty">本周沒有符合條件的事件。</div>'}
    <p class="bf-src">Forex Factory · Nasdaq · 取得 ${tmdhm(w.fetchedAt)} · 時間可能異動，以官方公布為準</p></section>`;
}

/* ---------- home ---------- */
function homePage() {
  const d = S.summary, [ml, mk] = market();
  if (!d) return errBox() + loadingBox();
  const h = d.heat, f = d.flows;
  const status = `<div class="statusline"><span class="pill"><span class="dot ${mk}"></span>${ml}</span><span class="pill">行情 ${d.dataDate || '未更新'}</span></div>${S.job?.running ? '' : updBtns(d.watch.length, S.stocks?.stocks.length)}`;
  const stale = d.dataDate && (Date.parse(twToday()) - Date.parse(d.dataDate)) / 864e5 > 4 ? `<div class="notice warn">研究名單行情停在 ${d.dataDate}，可按上方「更新研究名單」。</div>` : '';
  const ix = d.index, ixCard = (id, name, r) => `<button class="kpi ix-card" data-index="${id}"><span>${name} ›</span><b class="num ${cls(r?.change)}">${r?.close == null ? '—' : fmt(r.close, 2)}</b><em class="num ${cls(r?.change)}">${r?.change == null ? '' : `${r.change > 0 ? '+' : ''}${fmt(r.change, 2)}（${pct(r.pct)}）`}</em></button>`;
  const index = `<section class="card"><div class="card-h"><h2>大盤指數<small>${ix?.date ? `${ix.date.slice(5)} ${esc(ix.twse?.time || '')}` : ''}</small></h2></div><div class="kpis">${ixCard('TAIEX', '加權指數', ix?.twse)}${ixCard('TPEX', '櫃買指數', ix?.tpex)}</div><p class="ix-foot" style="padding:0 14px 10px">點指數卡看走勢、日 K、成交金額與漲跌家數</p></section>`;
  const heat = h ? `<section class="card"><div class="card-h"><h2>資金熱浪<small>${h.date}</small></h2><button class="more" data-go="heat">熱浪圖 ›</button></div>
    <div class="kpis"><div class="kpi"><span>總成交金額</span><b class="num">${yi(h.total.money)}<small>億</small></b></div><div class="kpi"><span>成交加權漲跌</span><b class="num ${cls(h.total.change)}">${pct(h.total.change)}</b><em>各股漲跌依成交金額加權，非加權指數</em></div><div class="kpi"><span>上漲／下跌</span><b class="num"><span class="up">${fmt(h.total.up)}</span> <small>/</small> <span class="down">${fmt(h.total.down)}</span></b><div class="breadth"><i class="u" style="width:${h.total.up / ((h.total.up + h.total.down) || 1) * 100}%"></i><i class="d" style="flex:1"></i></div></div><div class="kpi"><span>漲停家數</span><b class="num up">${fmt(h.total.limitUp)}</b></div></div>
    <div class="bars">${h.top.map(s => barRow(s.name, `<span class="${cls(s.change)}">${pct(s.change)}</span>`, s.share / (h.top[0].share || 1) * 100, `<span>成交占比 ${fmt(s.share, 1)}%</span><span class="${cls(s.moneyChange)}">${s.moneyChange == null ? '' : '量能 ' + pct(s.moneyChange, 0)}</span>`, `data-go="heat" data-focus="${esc(s.name)}"`)).join('')}</div></section>`
    : `<section class="card"><div class="card-h"><h2>資金熱浪</h2><button class="more" data-go="heat">查詢 ›</button></div><div class="empty">尚無熱浪圖紀錄，進入熱浪頁即可查詢。</div></section>`;
  const call = f?.options?.positions?.find(r => r.investor === '外資' && r.side === '買權'), put = f?.options?.positions?.find(r => r.investor === '外資' && r.side === '賣權');
  const flows = f ? `<section class="card"><div class="card-h"><h2>法人動向<small>${f.date}</small></h2><button class="more" data-go="flows">完整籌碼 ›</button></div>
    <div class="kpis"><div class="kpi"><span>三大法人合計</span><b class="num ${cls(f.summary.total)}">${sign(f.summary.total == null ? null : f.summary.total / 1e8, 1)}<small>億</small></b></div><div class="kpi"><span>外資</span><b class="num ${cls(f.summary.foreign)}">${sign(f.summary.foreign == null ? null : f.summary.foreign / 1e8, 1)}<small>億</small></b></div><div class="kpi"><span>投信</span><b class="num ${cls(f.summary.trust)}">${sign(f.summary.trust == null ? null : f.summary.trust / 1e8, 1)}<small>億</small></b></div><div class="kpi"><span>自營商</span><b class="num ${cls(f.summary.dealer)}">${sign(f.summary.dealer == null ? null : f.summary.dealer / 1e8, 1)}<small>億</small></b></div>
    <div class="kpi"><span>外資台指期淨未平倉</span><b class="num ${cls(f.futures.net)}">${sign(f.futures.net)}<small>口</small></b><em>增減 <span class="${cls(f.futures.netChange)}">${sign(f.futures.netChange)}</span></em></div><div class="kpi"><span>外資選擇權淨未平倉</span><b class="num" style="font-size:1.02rem">買權 <span class="${cls(call?.net)}">${sign(call?.net)}</span><br>賣權 <span class="${cls(put?.net)}">${sign(put?.net)}</span></b></div></div></section>`
    : `<section class="card"><div class="card-h"><h2>法人動向</h2><button class="more" data-go="flows">查詢 ›</button></div><div class="empty">尚無法人紀錄，可在籌碼頁查詢。</div></section>`;
  const watch = `<section class="card"><div class="card-h"><h2>自選股<small>${d.watch.length} 檔</small></h2><button class="more" data-go="stocks">全部 ›</button></div><div class="list">${d.watch.map(s => stockRow(s)).join('') || '<div class="empty">尚未加入自選股。在個股頁點 ☆ 即可加入。</div>'}</div></section>`;
  const movers = d.movers.length ? `<section class="card"><div class="card-h"><h2>研究名單漲跌</h2></div><div class="card-b"><div class="seg" role="group"><button class="${S.moverSide === 'up' ? 'on' : ''}" data-mover="up">漲幅前 5</button><button class="${S.moverSide === 'down' ? 'on' : ''}" data-mover="down">跌幅前 5</button></div></div><div class="list">${(S.moverSide === 'up' ? d.movers.slice(0, 5) : d.movers.slice(-5).reverse()).map(s => stockRow(s)).join('')}</div></section>` : '';
  const pats = `<section class="card"><div class="card-h"><h2>型態新訊號<small>${d.patternMeta?.asOf || ''}</small></h2><button class="more" data-go="patterns">全部 ›</button></div>${d.patterns.map(patCard).join('') || '<div class="empty">目前沒有量價確認或待確認的突破。</div>'}</section>`;
  const groups = d.groups.length ? `<section class="card"><div class="card-h"><h2>族群強弱</h2></div><div class="bars">${d.groups.map(g => barRow(g.name, fmt(g.score), g.score, `<span>站上季線 ${fmt(g.breadth)}%</span><span>營收年增 <span class="${cls(g.growth)}">${pct(g.growth, 1)}</span></span>`, `data-group="${esc(g.id)}"`)).join('')}</div></section>` : '';
  return `${status}${errBox()}${stale}${index}${heat}${flows}${watch}${movers}${pats}${groups}<div class="foot">資料經由電腦上的衡析 Nexus<br>研究資訊，非交易建議 · <button class="more" style="min-height:32px;font-size:.78rem" id="logout">登出這台裝置</button></div>`;
}

/* ---------- stocks ---------- */
/* ---------- 自選分組（與電腦版共用同一份分組） ---------- */
const watchData = () => S.stocks || { watchlist: [], watchGroups: { groups: [], assign: {} }, watchExtra: [], groups: [] };
// 加到自選／變更分組／新分組／移除的下拉選單（個股、型態明細共用）。
// 另列出還沒包含這檔股票的研究族群：選了會同時加入該研究族群（開始評分與每日更新）並加到自選
function watchSel(id, name = '') {
  const d = watchData(), g = d.watchGroups || { groups: [], assign: {} }, on = (d.watchlist || []).includes(id), cur = g.assign[id] || '';
  const research = (d.groups || []).filter(x => !x.stockIds?.includes(id)), opt = ([v, l, sel]) => `<option value="${v}" ${sel ? 'selected' : ''} ${v === '' ? 'disabled' : ''}>${esc(l)}</option>`;
  const rg = research.length ? `<optgroup label="${on ? '也加入研究族群' : '加到自選並加入研究族群'}">${research.map(x => opt([`r:${x.id}`, `${on ? '＋' : '☆'} 研究族群「${x.name}」`, false])).join('')}</optgroup>` : '';
  const opts = on ? [...g.groups.map(x => [`g:${x.id}`, `★ 自選：${x.name}`, cur === x.id]), ['g:', '★ 自選：未分組', !cur], ['new', '＋ 移到新分組…', false], ['remove', '✕ 移除自選', false]]
    : [['', '☆ 加到自選', true], ...g.groups.map(x => [`g:${x.id}`, `加到「${x.name}」`, false]), ['g:', g.groups.length ? '加到「未分組」' : '加入自選（未分組）', false], ['new', '＋ 建立新分組並加入…', false]];
  return `<select class="sel watchsel ${on ? 'on' : ''}" data-watch-set="${id}" data-watch-name="${esc(name)}" aria-label="自選分組"><optgroup label="自選分組">${opts.map(opt).join('')}</optgroup>${rg}</select>`;
}
const watchGroupSelect = (g, wl) => { const n = gid => wl.filter(id => gid === 'none' ? !g.assign[id] : g.assign[id] === gid).length; return `<div class="field"><select class="sel" id="wgroup" style="flex:1" aria-label="自選分組"><option value="">全部自選（${wl.length}）</option>${g.groups.map(x => `<option value="${x.id}" ${S.list.wgroup === x.id ? 'selected' : ''}>${esc(x.name)}（${n(x.id)}）</option>`).join('')}<option value="none" ${S.list.wgroup === 'none' ? 'selected' : ''}>未分組（${n('none')}）</option></select></div>`; };
const extraRow = s => `<button class="row" data-kbar="${s.id}"><span class="nm">${esc(s.name)}<small>${s.id}</small></span><span class="sub">${esc(s.sector || '')}${s.patterns?.length ? ` · 🎯 ${esc(s.patterns[0].name)}` : ''}</span><span class="rt"><span class="pc"><span class="px num">${fmt(s.price, 2)}</span><span class="chg num ${cls(s.change)}">${pct(s.change)}</span></span></span></button>`;
const syncWatchSel = (id, name) => $$(`[data-watch-set="${id}"]`).forEach(el => { el.outerHTML = watchSel(id, name); });
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.id === 'wgroup') { S.list.wgroup = t.value; S.list.limit = 40; return draw(); }
  if (!t.matches?.('[data-watch-set]')) return;
  const id = t.dataset.watchSet, name = t.dataset.watchName || id; let v = t.value;
  try {
    if (v === 'new') { // 手機上也能直接建立分組（改名、刪除請到電腦版「自選追蹤 → 管理分組」）
      const nm = (prompt('新分組名稱（1–20 字）') || '').trim(); if (!nm) return syncWatchSel(id, name);
      const cur = watchData().watchGroups?.groups || [], r = await api('api/watch/groups', { groups: [...cur.map(g => ({ id: g.id, name: g.name })), { name: nm }] });
      if (S.stocks) S.stocks.watchGroups = r.watchGroups; v = 'g:' + r.watchGroups.groups.find(g => g.name === nm).id;
    }
    t.disabled = true;
    // 研究族群：先加入族群（沒有行情資料時立即下載這檔），再加到自選（已在自選時保留原本的自選分組）
    const research = v.startsWith('r:') ? (watchData().groups || []).find(x => x.id === v.slice(2)) : null;
    let joined = null;
    if (research) { joined = await api('api/group-stock', { groupId: research.id, stockId: id }); if (joined.needsUpdate) { try { await api('api/update', { scope: 'selected', ids: [id] }); joined.updating = true; } catch { } } }
    const r = await api('api/watch', v === 'remove' ? { id, on: false } : research ? { id, on: true } : { id, on: true, group: v.slice(2) });
    if (research && S.stocks) { const rg = (S.stocks.groups || []).find(x => x.id === research.id); if (rg && !rg.stockIds?.includes(id)) rg.stockIds = [...(rg.stockIds || []), id]; }
    if (S.stocks) { S.stocks.watchlist = r.watchlist; S.stocks.watchGroups = r.watchGroups; }
    syncWatchSel(id, name); S.summary = null;
    const g = r.watchGroups.groups.find(x => x.id === r.watchGroups.assign[id]);
    toast(v === 'remove' ? `已將 ${name} 移出自選` : research ? `${name} 已加入研究族群「${research.name}」並加到自選${joined.updating ? '，正在下載行情' : joined.needsUpdate ? '，請更新此股以取得行情' : ''}` : `${name} 已加到自選${g ? `「${g.name}」` : '（未分組）'}`);
    loadStocks(S.tab === 'stocks' && !$('#sheet')?.classList.contains('open')).catch(() => { }); // 重新取得（含研究名單以外自選股的報價）
  } catch (err) { if (!err.silent) toast(err.message); syncWatchSel(id, name); }
});
function stocksPage() {
  const d = S.stocks, L = S.list;
  if (!d) return errBox() + loadingBox();
  const wgs = d.watchGroups || { groups: [], assign: {} }, wl = d.watchlist || [], inWg = id => !L.wgroup || (L.wgroup === 'none' ? !wgs.assign[id] : wgs.assign[id] === L.wgroup);
  if (L.wgroup && L.wgroup !== 'none' && !wgs.groups.some(g => g.id === L.wgroup)) L.wgroup = '';
  const extra = L.mode === 'watch' ? (d.watchExtra || []).filter(s => inWg(s.id) && (!L.q || `${s.id} ${s.name}`.toLowerCase().includes(L.q.toLowerCase()))) : [];
  let rows = d.stocks.filter(s => (L.mode !== 'watch' || (s.watch && inWg(s.id))) && (L.mode === 'watch' || !L.group || d.groups.find(g => g.id === L.group)?.stockIds.includes(s.id)) && (!L.q || `${s.id} ${s.name}`.toLowerCase().includes(L.q.toLowerCase())));
  rows.sort(L.sort === 'change' ? (a, b) => (b.change ?? -999) - (a.change ?? -999) : L.sort === 'code' ? (a, b) => a.id.localeCompare(b.id) : (a, b) => (b.score ?? -1) - (a.score ?? -1) || (b.change ?? -999) - (a.change ?? -999));
  return `${errBox()}${S.job?.running ? '' : updBtns(d.stocks.filter(s => s.watch).length, d.stocks.length)}<div class="toolbar"><label class="search">${svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>')}<input id="q" type="search" inputmode="search" placeholder="搜尋代碼或名稱" value="${esc(L.q)}" autocomplete="off"></label>
    <div class="seg"><button class="${L.mode === 'watch' ? 'on' : ''}" data-mode="watch">自選 ${wl.length}</button><button class="${L.mode === 'all' ? 'on' : ''}" data-mode="all">研究名單 ${d.stocks.length}</button></div>
    ${L.mode === 'watch' ? watchGroupSelect(wgs, wl) : ''}${L.mode === 'all' ? `<div class="chips"><button class="chip ${!L.group ? 'on' : ''}" data-grp="">全部族群</button>${d.groups.map(g => `<button class="chip ${L.group === g.id ? 'on' : ''}" data-grp="${esc(g.id)}">${esc(g.name)}</button>`).join('')}</div>` : ''}
    <div class="seg"><button class="${L.sort === 'score' ? 'on' : ''}" data-sort="score">綜合分數</button><button class="${L.sort === 'change' ? 'on' : ''}" data-sort="change">漲跌幅</button><button class="${L.sort === 'code' ? 'on' : ''}" data-sort="code">代碼</button></div></div>
    <section class="card"><div class="list">${rows.slice(0, L.limit).map(s => stockRow(s, { showSpark: true })).join('') || (extra.length ? '<div class="empty">這個分組在研究名單內沒有自選股</div>' : `<div class="empty">${L.mode === 'watch' ? (L.wgroup ? '這個分組還沒有股票。' : '尚無自選股。在「研究名單」或「型態」點選個股後選「加到自選」。') : '沒有符合的股票'}</div>`)}</div></section>
    ${rows.length > L.limit ? `<button class="btn block" data-more-stocks>再載入 ${Math.min(40, rows.length - L.limit)} 檔（共 ${rows.length}）</button>` : ''}
    ${extra.length ? `<section class="card"><div class="card-h"><h2>研究名單以外的自選股<small>${extra.length} 檔 · 無四維評分 · 點選看 K 線</small></h2></div><div class="list">${extra.map(extraRow).join('')}</div></section>` : ''}<div class="foot">資料日期 ${d.dataDate || '—'} · 分數為研究排序，非買賣訊號</div>`;
}

/* ---------- stock sheet ---------- */
function kline(bars) {
  if (!bars?.length) return '<div class="empty">尚無價格資料</div>';
  const W = 360, H = 210, L = 4, R = 44, T = 10, B = 22, n = bars.length, cw = (W - L - R) / n;
  const vals = bars.flatMap(b => [b[2], b[3], b[5], b[6]]).filter(v => v != null), hi = Math.max(...vals), lo = Math.min(...vals), rg = hi - lo || 1;
  const y = v => T + (hi - v) / rg * (H - T - B), x = i => L + (i + .5) * cw;
  let g = '';
  for (let i = 0; i < 4; i++) { const v = lo + rg * i / 3; g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${W - R + 4}" y="${y(v) + 4}" font-size="10" fill="var(--soft)">${fmt(v, v < 100 ? 1 : 0)}</text>`; }
  bars.forEach((b, i) => { const c = b[4] >= b[1] ? 'var(--up)' : 'var(--down)'; g += `<line x1="${x(i)}" x2="${x(i)}" y1="${y(b[2])}" y2="${y(b[3])}" stroke="${c}" stroke-width=".8"/><rect x="${x(i) - cw * .32}" y="${y(Math.max(b[1], b[4]))}" width="${Math.max(1, cw * .64)}" height="${Math.max(.8, Math.abs(y(b[1]) - y(b[4])))}" fill="${c}"/>`; });
  for (const [k, c] of [[5, 'var(--amber)'], [6, 'var(--violet)']]) { const pts = bars.map((b, i) => b[k] == null ? null : `${x(i)},${y(b[k])}`).filter(Boolean); if (pts.length) g += `<polyline points="${pts.join(' ')}" fill="none" stroke="${c}" stroke-width="1.4"/>`; }
  g += `<text x="${L}" y="${H - 6}" font-size="10" fill="var(--soft)">${bars[0][0].slice(5)}</text><text x="${W - R}" y="${H - 6}" font-size="10" fill="var(--soft)" text-anchor="end">${bars.at(-1)[0].slice(5)}</text><line id="kx" x1="-10" x2="-10" y1="${T}" y2="${H - B}" stroke="var(--text)" stroke-dasharray="2 3" opacity=".6"/>`;
  return `<svg class="chart" id="kline" viewBox="0 0 ${W} ${H}" data-n="${n}" data-l="${L}" data-cw="${cw}" role="img" aria-label="近 ${n} 日 K 線">${g}</svg>`;
}
async function openStock(id) {
  openSheet('讀取中…', loadingBox());
  try {
    const s = await api('api/stock?id=' + encodeURIComponent(id)); S.sheetStock = s;
    if (!S.stocks) await loadStocks().catch(() => { }); else refreshWatchSel(s.id, s.name); // 自選分組選單需要清單資料（太舊時在背景更新）
    const ringC = 2 * Math.PI * 31, val = s.score ?? 0;
    $('#sheet-title').innerHTML = `${esc(s.name)}<small>${s.id} · ${esc(s.market)}</small>`;
    $('#sheet-body').innerHTML = `<div class="hero"><div><div class="big num ${cls(s.change)}">${fmt(s.price, 2)}</div><div class="num ${cls(s.change)}" style="font-weight:700">${pct(s.change)}</div><div class="meta">${s.asOf || '未更新'} · 成交 ${fmt(s.volume)} 張<br>${esc(s.groups.join('、') || s.sector)}</div></div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:6px"><div class="ring"><svg viewBox="0 0 74 74"><circle cx="37" cy="37" r="31" stroke="var(--line)" stroke-width="7" fill="none"/><circle cx="37" cy="37" r="31" stroke="${val >= 75 ? 'var(--amber)' : 'var(--accent)'}" stroke-width="7" fill="none" ${val > 0 ? 'stroke-linecap="round"' : ''} stroke-dasharray="${ringC * val / 100} ${ringC}"/></svg><b class="num">${s.score == null ? '—' : fmt(s.score)}</b></div><span class="pill">${esc(s.rating)}</span></div></div>
      <div class="field" style="margin-bottom:12px">${watchSel(s.id, s.name)}<button class="btn" data-stock="${s.id}" style="margin-left:8px">走勢／五檔 ›</button></div>
      <div class="upd-row" style="margin-bottom:12px"><button class="btn" data-upd-stock="${s.id}">⟳ 更新此股資料</button><button class="btn" data-news="${s.id}">📰 取得近三日新聞</button></div>
      <section class="card"><div class="card-h"><h2>四維評分<small>有效權重 ${s.coverage}%</small></h2></div><div class="card-b">${s.factors.map((f, i) => `<div class="factor"><span>${FACTORS[i][1]} <small class="soft">${s.weights?.[f.key] ?? ''}%</small></span><span class="track"><i style="width:${f.score ?? 0}%"></i></span><b class="num">${f.score == null ? '—' : fmt(f.score)}</b></div>`).join('')}</div></section>
      <section class="card"><div class="card-h"><h2>近 90 日 K 線</h2></div><div class="card-b">${kline(s.bars)}<div class="chart-tip num" id="ktip">按住圖表查看每日價格</div><div class="legend"><span style="color:var(--amber)">━ MA20 ${fmt(s.tech.ma20, 1)}</span><span style="color:var(--violet)">━ MA60 ${fmt(s.tech.ma60, 1)}</span><span>還原價格</span></div></div></section>
      ${rulesCard({ id: s.id, name: s.name, close: s.price })}${stockExtrasShell(s.id)}
      <section class="card"><div class="card-h"><h2>重點數據</h2></div><div class="card-b grid4">${[['20 日報酬', pct(s.tech.r20, 1), cls(s.tech.r20)], ['60 日報酬', pct(s.tech.r60, 1), cls(s.tech.r60)], ['法人 5 日', sign(s.chips.net5) + ' 張', cls(s.chips.net5)], ['法人 20 日', sign(s.chips.net20) + ' 張', cls(s.chips.net20)], ['本益比', fmt(s.valuation.pe, 1) + ' 倍', ''], ['股價淨值比', fmt(s.valuation.pb, 2) + ' 倍', ''], ['殖利率', fmt(s.valuation.yield, 2) + '%', ''], ['近三月營收年增', pct(s.revenue.yoy, 1), cls(s.revenue.yoy)]].map(([a, b, c]) => `<div class="stat"><span>${a}</span><b class="num ${c}">${b}</b></div>`).join('')}</div></section>
      ${s.risks.length ? `<section class="card"><div class="card-h"><h2>需要留意</h2></div><ul class="reasons risk">${s.risks.map(r => `<li>${esc(r)}</li>`).join('')}</ul></section>` : ''}
      ${s.factors.map((f, i) => `<details class="card"><summary>${FACTORS[i][1]}依據 <span class="soft num" style="margin-left:auto;margin-right:10px">${f.date || ''}</span></summary><ul class="reasons">${f.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul></details>`).join('')}
      <section class="card news"><div class="card-h"><h2>相關新聞</h2></div>${s.news.map(n => `<a href="${safe(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.title || '閱讀原文')}<small>${esc(n.source || '')} · ${esc(String(n.date).slice(0, 16))}</small></a>`).join('') || '<div class="empty">尚無新聞，可按上方「取得近三日新聞」。</div>'}</section>
      <div class="foot">分數為研究排序，不代表報酬或合理股價</div>`;
    fillStockExtras(s.id);
  } catch (e) { if (!e.silent) $('#sheet-body').innerHTML = `<div class="notice err">${esc(e.message)}</div>`; }
}
const safe = u => { try { const x = new URL(u); return ['http:', 'https:'].includes(x.protocol) ? esc(x.href) : '#'; } catch { return '#'; } };
function klineTouch(e) {
  const el = e.target.closest?.('#kline'); if (!el || !S.sheetStock) return;
  const rect = el.getBoundingClientRect(), vx = (e.clientX - rect.left) / rect.width * 360, n = +el.dataset.n, i = Math.max(0, Math.min(n - 1, Math.floor((vx - +el.dataset.l) / +el.dataset.cw)));
  const b = S.sheetStock.bars[i]; if (!b) return;
  const line = el.querySelector('#kx'), x = +el.dataset.l + (i + .5) * +el.dataset.cw; line.setAttribute('x1', x); line.setAttribute('x2', x);
  const prev = S.sheetStock.bars[i - 1]?.[4], ch = prev ? (b[4] / prev - 1) * 100 : null;
  $('#ktip').innerHTML = `${b[0]}　開 ${fmt(b[1], 2)}　高 ${fmt(b[2], 2)}　低 ${fmt(b[3], 2)}　收 <b class="${cls(ch)}">${fmt(b[4], 2)} ${ch == null ? '' : pct(ch)}</b>`;
}
document.addEventListener('pointerdown', klineTouch); document.addEventListener('pointermove', e => { if (e.buttons || e.pointerType === 'mouse') klineTouch(e); });

/* ---------- sheet ---------- */
function openSheet(title, body) {
  $('#sheet-title').textContent = title; $('#sheet-body').innerHTML = body; $('#sheet-body').scrollTop = 0;
  if (!$('#sheet').classList.contains('open')) { history.pushState({ tab: S.tab, sheet: 1 }, '', location.hash); }
  $('#sheet').classList.add('open'); $('#backdrop').classList.add('open'); document.body.style.overflow = 'hidden';
}
function closeSheet(fromPop = false) { if (!$('#sheet')?.classList.contains('open')) return; $('#sheet').classList.remove('open'); $('#backdrop').classList.remove('open'); document.body.style.overflow = ''; S.sheetStock = null; if (!fromPop) history.back(); }
let touchY = null;
document.addEventListener('touchstart', e => { if (e.target.closest('.sheet-h,.grab')) touchY = e.touches[0].clientY; }, { passive: true });
document.addEventListener('touchend', e => { if (touchY != null && e.changedTouches[0].clientY - touchY > 70) closeSheet(); touchY = null; }, { passive: true });
window.addEventListener('popstate', e => { if ($('#sheet')?.classList.contains('open')) { closeSheet(true); return; } const t = (location.hash || '#brief').slice(1); if (t !== S.tab) setTab(t, false); });

/* ---------- heat ---------- */
let heatRequest = 0;
async function loadHeat(date, query = false) {
  const request = ++heatRequest; S.heat.feed = null;
  const H = S.heat; H.loading = request; H.error = ''; if (S.tab === 'heat') draw();
  try {
    const r = query ? await api('api/heatmap/query', { date }) : await api('api/heatmap?date=' + encodeURIComponent(date || 'latest'));
    if (request !== heatRequest) return;
    H.dates = r.dates || H.dates; if (r.data) { H.data = r.data; H.agg = null; } else if (date && !query) H.error = '此日沒有紀錄，請按「查詢」。';
  } catch (e) { if (request === heatRequest && !e.silent) H.error = e.message; }
  finally { if (H.loading === request) H.loading = false; }
  if (request === heatRequest && !date && !query && !H.tried) { H.tried = true; const want = defaultHeatDate(); if (!H.data || H.data.date < want && !H.dates.includes(want)) { const had = !!H.data; await loadHeat(want, true); if (H.error && had) H.error = `最新交易日尚未取得（${H.error}），目前顯示 ${H.data.date}。`; } }
}
// 盤中定時向 Nexus 取即時熱浪圖；Nexus 端共用同一份快照。
function liveOpen() {
  return MK.isOpen();
}
async function loadLive() {
  const H = S.heat; if (H.liveBusy || H.loading || !H.live) return;
  const request = ++heatRequest;
  H.liveBusy = request;
  try { const r = currentHeatResponse(await api('api/heatmap/live'), twToday()); if (request !== heatRequest || !H.live || replayActive()) return; H.feed = r.feed || null; if (r.feed && !r.data) { H.data = null; H.agg = null; H.error = ''; } if (r.data) { H.data = r.data; H.agg = null; H.error = ''; if (H.focus && !r.data.sectors.some(s => s.name === H.focus)) H.focus = null; } }
  catch (e) { if (request !== heatRequest || !H.live || replayActive()) return; if (H.feed) { H.feed = { ...H.feed, status: 'error' }; H.data = null; H.agg = null; } if (!e.silent) { H.error = `盤中即時更新失敗：${e.message}`; if (/權限不足|額度/.test(e.message)) { H.live = false; H.error += '；已暫停自動更新。'; } } }
  finally { if (H.liveBusy === request) H.liveBusy = false; if (S.tab === 'heat' && !$('#sheet')?.classList.contains('open')) draw(); }
}
setInterval(() => { if (S.tab === 'heat' && S.heat.live && (liveOpen() || S.heat.feed) && !document.hidden && !replayActive()) loadLive(); }, 10000);
function heatAgg() { const H = S.heat; if (!H.data) return null; if (!H.agg || H.aggMarket !== H.market) { H.agg = aggregate(H.data, H.market); H.aggMarket = H.market; } return H.agg; }
function heatPage() {
  const H = S.heat, a = heatAgg(), d = H.data;
  const date = d?.date || defaultHeatDate(), open = liveOpen();
  const ctl = `<div class="toolbar"><div class="field"><input type="date" id="heat-date" value="${date}" max="${twToday()}" min="2015-01-05" aria-label="交易日期" style="flex:1"><button class="btn primary" data-heat-query ${H.loading ? 'disabled' : ''}>${H.loading ? '<span class="spinner"></span>' : '查詢'}</button><button class="btn${H.live && open ? ' primary' : ''}" data-hlive aria-pressed="${H.live}">${H.liveBusy ? '<span class="spinner"></span>' : H.live && open ? '●' : '○'} 即時${H.live ? (open ? ' 10 秒' : '') : ' 暫停'}</button><button class="btn" data-replay-open aria-label="時光機">⏱</button></div>
    <div class="seg">${['全部', '上市', '上櫃'].map(m => `<button class="${H.market === m ? 'on' : ''}" data-hmarket="${m}">${m}</button>`).join('')}</div></div>`;
  if (!d) return ctl + heatFeedNotice(H.feed) + (H.error ? `<div class="notice err">${esc(H.error)}</div>` : '') + (H.loading ? `<div class="empty"><span class="spinner"></span> 正在讀取全市場成交資料…</div>` : '<div class="empty">尚無資料，請選擇日期後按「查詢」。</div>');
  const t = a.total, focus = H.focus && a.sectors.find(s => s.name === H.focus), sel = H.sel && a.byId.get(H.sel);
  return `${ctl}${heatFeedNotice(H.feed)}${H.error ? `<div class="notice warn">${esc(H.error)}</div>` : ''}
    <div class="kpis" style="padding:0;margin-bottom:10px"><div class="kpi"><span>${d.live ? `${open ? '盤中' : '盤中最後'} ${esc((d.asOf || d.retrievedAt).slice(11, 19))} 累計成交` : `${d.date} 成交金額`}</span><b class="num">${yi(t.money)}<small>億</small></b></div><div class="kpi"><span>成交加權漲跌 · 漲停 ${t.limitUp}</span><b class="num ${cls(t.change)}">${pct(t.change)}</b><div class="breadth"><i class="u" style="width:${t.up / (t.count || 1) * 100}%"></i><i class="f" style="width:${t.flat / (t.count || 1) * 100}%"></i><i class="d" style="flex:1"></i></div></div></div>
    <div class="hm-bar">${focus ? `<button class="btn" data-hback style="min-height:36px;padding:0 12px">${d.scope === 'research' ? '‹ 研究範圍' : '‹ 全市場'}</button>` : ''}<span class="crumb">${focus ? `${esc(focus.name)} <span class="${cls(focus.change)} num">${pct(focus.change)}</span> <small class="soft">${yi(focus.money)} 億 · ${focus.count} 檔</small>` : `${a.sectors.length} 個板塊 <small class="soft">· 點板塊標題放大</small>`}</span></div>
    <div class="hm-wrap"><div id="hm" role="img" aria-label="資金板塊熱浪圖"></div></div>
    <div class="hm-legend">${[-7, -5, -3, -1, 0, 1, 3, 5, 7].map(v => `<span style="background:${heatColor(v)}">${v > 0 ? '+' : ''}${v}</span>`).join('')}</div>
    ${sel ? `<div class="hm-pick"><span class="nm">${esc(sel.name)}<small>${sel.id} · ${esc(sel.market)}</small></span><span class="num ${cls(sel.change)}" style="font-weight:800;font-size:1.1rem;text-align:right">${fmt(sel.close, 2)}<br><small>${pct(sel.change)}</small></span><span class="sub">${esc(sel.sector)} · 成交 ${yi(sel.money)} 億${sel.prevMoney ? ` · 量能 ${pct((sel.money / sel.prevMoney - 1) * 100, 0)}` : ''}</span><span></span><div class="acts"><button class="btn" data-hclose aria-label="關閉" style="flex:0 0 44px;padding:0">✕</button><button class="btn primary" data-stock="${sel.id}">走勢／五檔</button>${inScope(sel.id) ? `<button class="btn" data-stock-detail="${sel.id}">個股診斷</button>` : ''}<button class="btn" data-hsec="${esc(sel.sector)}">放大 ${esc(sel.sector)}</button></div></div>` : ''}
    <section class="card" style="margin-top:10px"><div class="card-h"><h2>板塊資金排行</h2></div><div class="bars">${a.sectors.slice(0, 30).map(s => barRow(s.name, `<span class="${cls(s.change)}">${pct(s.change)}</span>`, s.money / a.sectors[0].money * 100, `<span>${yi(s.money)} 億 · ${fmt(s.share, 1)}% · <span class="up">${s.up}</span>/<span class="down">${s.down}</span></span><span class="${cls(s.moneyChange)}">${s.moneyChange == null ? '' : '量能 ' + pct(s.moneyChange, 0)}</span>`, `data-hsec="${esc(s.name)}"`)).join('')}</div></section>
    ${H.dates.length > 1 ? `<div class="field" style="margin-bottom:12px"><select class="sel" id="heat-cached" style="flex:1" aria-label="歷史紀錄"><option value="">切換歷史紀錄（${H.dates.length} 日）</option>${H.dates.slice().reverse().map(x => `<option value="${x}">${x}</option>`).join('')}</select></div>` : ''}
    <div class="foot">面積＝成交金額 · 顏色＝漲跌幅 · 證交所產業別<br>成交金額代表交投熱度，不等於資金淨流入</div>`;
}
let hmObserver;
function mountHeat() {
  const el = $('#hm'); if (!el || !S.heat.data) return;
  const run = () => renderTreemap(el, heatAgg(), { focus: S.heat.focus, selected: S.heat.sel });
  run(); hmObserver?.disconnect(); let pending; hmObserver = new ResizeObserver(() => { cancelAnimationFrame(pending); pending = requestAnimationFrame(run); }); hmObserver.observe(el);
}

/* ---------- patterns ---------- */
function patCard(r) {
  return `<button class="pcard" data-pat="${r.id}" data-pid="${r.pid}"><div class="top"><b>${esc(r.name)} <small class="soft">${r.id}</small></b><span class="badge ${r.status === '量價確認' ? 'ok' : /突破/.test(r.status) ? 'wait' : ''}">${esc(r.status)}</span></div>
  <div class="soft" style="font-size:.8rem;margin-top:2px">${esc(r.pattern)} · ${esc(r.category)} · ${esc(r.sector)}</div><div class="meter"><i style="width:${r.score}%"></i></div>
  <div class="plan num"><div><span>強度</span><b>${r.score}</b></div><div><span>進場帶</span><b>${fmt(r.entry, r.entry < 100 ? 2 : 1)}</b></div><div><span>防守</span><b class="down">${fmt(r.stop, r.stop < 100 ? 2 : 1)}</b></div><div><span>R/R</span><b>${fmt(r.rr, 1)}</b></div></div></button>`;
}
function patternPage() {
  const p = S.pat; if (!p) return errBox() + loadingBox();
  const rows = p.rows.filter(r => (!S.patStatus || r.status === S.patStatus) && (!S.patCat || r.category === S.patCat));
  return `${errBox()}<div class="statusline"><span class="pill">${p.from || '—'} → ${p.asOf || '—'}</span><span class="pill">${fmt(p.matched)} 檔 · ${fmt(p.count)} 筆型態</span>${S.job?.running ? '' : '<button class="btn" data-pat-update style="min-height:32px;margin-left:auto">⟳ 更新型態資料</button>'}</div>
    <div class="toolbar"><div class="seg">${[['', '全部'], ['量價確認', '量價確認'], ['突破待次日確認', '待次日確認'], ['突破待量確認', '待量確認'], ['接近突破', '接近突破']].map(([v, l]) => `<button class="${S.patStatus === v ? 'on' : ''}" data-pstatus="${v}">${l}</button>`).join('')}</div>
    <div class="chips">${['', '反轉型', '延續型', '整理突破型'].map(c => `<button class="chip ${S.patCat === c ? 'on' : ''}" data-pcat="${c}">${c || '所有類別'}</button>`).join('')}</div></div>
    ${p.eligible === 0 ? '<div class="notice warn">型態資料已超過 7 天或不足 90 日，請按上方「更新型態資料」。</div>' : ''}
    <section class="card">${rows.slice(0, S.patLimit).map(patCard).join('') || '<div class="empty">沒有符合條件的型態</div>'}</section>
    ${rows.length > S.patLimit ? `<button class="btn block" data-more-pat>再載入（共 ${rows.length} 筆）</button>` : ''}<div class="foot">強度為規則吻合程度，不是勝率；價位為條件式技術試算</div>`;
}
function patChart(s, m) {
  const p = s.bars, W = 360, H = 230, L = 4, R = 44, T = 10, B = 40, n = p.length, cw = (W - L - R) / n;
  const lo = Math.min(...p.map(b => b[3]), m.plan.stop), hi = Math.max(...p.map(b => b[2]), m.resistance ?? 0), rg = hi - lo || 1, vmax = Math.max(...p.map(b => b[5])) || 1;
  const y = v => T + (hi - v) / rg * (H - T - B), x = i => L + (i + .5) * cw;
  const si = p.findIndex(b => b[0] === m.start), ei = p.findIndex(b => b[0] === m.end);
  let g = si >= 0 && ei >= 0 ? `<rect x="${x(si)}" y="${T}" width="${x(ei) - x(si)}" height="${H - T - B}" fill="var(--accent)" opacity=".08"/>` : '';
  for (let i = 0; i < 4; i++) { const v = lo + rg * i / 3; g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${W - R + 4}" y="${y(v) + 4}" font-size="10" fill="var(--soft)">${fmt(v, v < 100 ? 1 : 0)}</text>`; }
  p.forEach((b, i) => { const c = b[4] >= b[1] ? 'var(--up)' : 'var(--down)'; g += `<line x1="${x(i)}" x2="${x(i)}" y1="${y(b[2])}" y2="${y(b[3])}" stroke="${c}" stroke-width=".8"/><rect x="${x(i) - cw * .32}" y="${y(Math.max(b[1], b[4]))}" width="${Math.max(1, cw * .64)}" height="${Math.max(.8, Math.abs(y(b[1]) - y(b[4])))}" fill="${c}"/><rect x="${x(i) - cw * .32}" y="${H - 6 - b[5] / vmax * 24}" width="${Math.max(1, cw * .64)}" height="${b[5] / vmax * 24}" fill="var(--soft)" opacity=".5"/>`; });
  (m.lines || []).forEach((l, i) => { g += `<line x1="${x(l.from)}" x2="${x(l.to)}" y1="${y(l.a)}" y2="${y(l.b)}" stroke="${i ? 'var(--down)' : 'var(--amber)'}" stroke-width="1.6" stroke-dasharray="5 3"/>`; });
  (m.anchors || []).forEach(a => { g += `<circle cx="${x(a.index)}" cy="${y(a.price)}" r="3" fill="var(--accent)"/>`; });
  g += `<line x1="${L}" x2="${W - R}" y1="${y(m.plan.stop)}" y2="${y(m.plan.stop)}" stroke="var(--down)" stroke-width=".8" opacity=".7"/>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(m.name)} 90 日 K 線">${g}</svg>`;
}
async function openPattern(id, pid) {
  openSheet('讀取中…', loadingBox());
  try {
    const s = await api(`api/pattern?id=${encodeURIComponent(id)}&pid=${encodeURIComponent(pid)}`), m = s.match, pl = m.plan;
    if (!S.stocks) await loadStocks().catch(() => { }); else refreshWatchSel(s.id, s.name); // 自選分組選單需要清單資料（太舊時在背景更新）
    $('#sheet-title').innerHTML = `${esc(s.name)}<small>${s.id} · ${esc(m.name)}</small>`;
    $('#sheet-body').innerHTML = `<div class="statusline"><span class="badge ${m.status === '量價確認' ? 'ok' : 'wait'}">${esc(m.status)}</span><span class="pill">${esc(m.category)}</span><span class="pill">強度 ${m.score}</span><span class="pill">${s.asOf} 收 ${fmt(s.price, 2)}</span></div>
      <div class="field" style="margin-bottom:12px">${watchSel(s.id, s.name)}<button class="btn" data-stock="${s.id}" style="margin-left:8px">走勢／五檔 ›</button></div>
      <section class="card"><div class="card-b" style="padding-top:12px">${patChart(s, m)}<div class="legend"><span style="color:var(--amber)">┅ 頸線／壓力</span><span style="color:var(--down)">┅ 支撐／防守</span><span style="color:var(--accent)">● 轉折</span></div></div></section>
      <section class="card"><div class="card-h"><h2>條件式計畫<small>${esc(pl.action)}</small></h2></div><div class="card-b grid4">${[['進場帶', `${fmt(pl.entry, 2)}–${fmt(pl.entryMax, 2)}`, ''], ['結構防守', fmt(pl.stop, 2), 'down'], ['量度觀察位', fmt(pl.target, 2), 'up'], ['估算淨 R/R', fmt(pl.rr, 2), '']].map(([a, b, c]) => `<div class="stat"><span>${a}</span><b class="num ${c}">${b}</b></div>`).join('')}</div>
      <ul class="reasons">${[pl.confirmation, pl.defense, pl.targetBasis, pl.timing, pl.missing].filter(Boolean).map(t => `<li>${esc(t)}</li>`).join('')}</ul></section>
      <section class="card"><div class="card-h"><h2>為何判定此型態</h2></div><ul class="reasons"><li>${esc(m.description)}</li><li>區間 ${m.start} → ${m.end}${m.breakoutDate ? ` · 首次突破 ${m.breakoutDate}` : ' · 尚未突破'} · 量比 ${fmt(m.volumeRatio, 2)} 倍</li><li>結構 ${m.scoreParts?.geometry} + 確認 ${m.scoreParts?.confirmation} + 量能 ${m.scoreParts?.volume} + 均線 ${m.scoreParts?.trend}</li></ul></section>
      <section class="card"><div class="card-h"><h2>失效與誤判提醒</h2></div><ul class="reasons risk">${(m.warnings || []).map(w => `<li>${esc(w)}</li>`).join('')}</ul></section>
      <div class="foot">型態分數非勝率，規則未經回測校準；非交易建議</div>`;
  } catch (e) { if (!e.silent) $('#sheet-body').innerHTML = `<div class="notice err">${esc(e.message)}</div>`; }
}

/* ---------- flows ---------- */
async function loadFlows(date, query = false) {
  const F = S.flows; F.loading = true; F.error = ''; if (S.tab === 'flows') draw();
  try {
    const r = query ? await api('api/flows/query', { date }) : await api('api/flows?date=' + encodeURIComponent(date || 'latest'));
    if (r.data) { F.data = r.data; F.date = r.data.date; F.contract = r.data.options?.defaultContract; const c = r.data.options?.contracts?.find(c => c.contract === F.contract); F.page = Math.max(0, Math.floor((c?.strikes.findIndex(x => x.strike === c.callPeak) || 0) / 20)); }
    else F.error = date ? '此日沒有本機紀錄，請按「查詢 FinMind」。' : '尚無法人紀錄，請選擇日期後查詢。';
  } catch (e) { if (!e.silent) F.error = e.message; }
  finally { F.loading = false; }
}
// 籌碼分頁：法人（法人與期權籌碼）、分點追蹤、大戶排行（後兩者需要券商分點能力）
const chipsOn = () => !!S.profile?.capabilities?.brokers;
function flowPage() {
  const seg = chipsOn() ? `<div class="seg" style="margin-bottom:12px">${[['inst', '法人'], ['brokers', '分點追蹤'], ['holders', '大戶排行']].map(([v, l]) => `<button class="${S.flows.view === v ? 'on' : ''}" data-fview="${v}">${l}</button>`).join('')}</div>` : '';
  if (chipsOn() && S.flows.view === 'brokers') return seg + brokersView();
  if (chipsOn() && S.flows.view === 'holders') return seg + holdersView();
  return seg + instPage();
}
function instPage() {
  const F = S.flows, d = F.data;
  const ctl = `<div class="toolbar"><div class="field"><input type="date" id="flow-date" value="${F.date || twToday()}" max="${twToday()}" min="2018-06-05" style="flex:1" aria-label="交易日期"><button class="btn" data-flow-load ${F.loading ? 'disabled' : ''}>紀錄</button><button class="btn primary" data-flow-query ${F.loading ? 'disabled' : ''}>${F.loading ? '<span class="spinner"></span>' : '查詢'}</button></div></div>`;
  if (F.loading && !d) return ctl + '<div class="empty"><span class="spinner"></span> 正在依序取得法人、期貨與選擇權資料（約 1 分鐘）…</div>';
  if (!d) return ctl + (F.error ? `<div class="notice">${esc(F.error)}</div>` : loadingBox());
  const s = d.summary, f = d.futures, op = d.options?.positions || [], get = (i, side) => op.find(r => r.investor === i && r.side === side);
  const rk = d.rankings.find(r => r.market === F.market && r.investor === F.inv), list = rk ? rk[F.side] : [];
  const e8 = v => v == null ? null : v / 1e8;
  return `${ctl}${F.error ? `<div class="notice err">${esc(F.error)}</div>` : ''}${Object.values(d.errors || {}).length ? `<div class="notice warn">部分資料未取得：${esc(Object.values(d.errors).join('；'))}</div>` : ''}
    <section class="card"><div class="card-h"><h2>三大法人買賣超<small>${d.date} · 億元</small></h2></div><div class="kpis">${[['合計', s.total], ['外資及陸資', s.foreign], ['投信', s.trust], ['自營商', s.dealer]].map(([a, v]) => `<div class="kpi"><span>${a}</span><b class="num ${cls(v)}">${sign(e8(v), 2)}</b></div>`).join('')}</div></section>
    <section class="card"><div class="card-h"><h2>外資期權部位<small>口</small></h2></div><div class="kpis"><div class="kpi"><span>台指期淨未平倉</span><b class="num ${cls(f.net)}">${sign(f.net)}</b><em>增減 <span class="${cls(f.netChange)}">${sign(f.netChange)}</span> · 比較 ${f.previousDate?.slice(5) || '—'}</em></div><div class="kpi"><span>多單／空單</span><b class="num" style="font-size:1.05rem"><span class="up">${fmt(f.long)}</span> / <span class="down">${fmt(f.short)}</span></b></div>
      <div class="kpi"><span>選擇權買權淨額</span><b class="num ${cls(get('外資', '買權')?.net)}">${sign(get('外資', '買權')?.net)}</b><em>增減 ${sign(get('外資', '買權')?.netChange)}</em></div><div class="kpi"><span>選擇權賣權淨額</span><b class="num ${cls(get('外資', '賣權')?.net)}">${sign(get('外資', '賣權')?.net)}</b><em>增減 ${sign(get('外資', '賣權')?.netChange)}</em></div></div></section>
    <section class="card"><div class="card-h"><h2>個股買賣超排行<small>張</small></h2></div><div class="card-b toolbar" style="margin:0">
      <div class="seg">${['上市', '上櫃'].map(m => `<button class="${F.market === m ? 'on' : ''}" data-fmarket="${m}">${m}</button>`).join('')}</div>
      <div class="seg">${[['total', '三大法人'], ['foreign', '外資'], ['trust', '投信'], ['dealer', '自營商']].map(([k, l]) => `<button class="${F.inv === k ? 'on' : ''}" data-finv="${k}">${l}</button>`).join('')}</div>
      <div class="seg"><button class="${F.side === 'buy' ? 'on' : ''}" data-fside="buy">買超</button><button class="${F.side === 'sell' ? 'on' : ''}" data-fside="sell">賣超</button></div></div>
      ${list.map((r, i) => `<button class="rank" data-stock="${esc(r.id)}"><span class="i num">${i + 1}</span><span class="n">${esc(r.name)}<small>${r.id}</small></span><span class="v num ${F.side === 'buy' ? 'up' : 'down'}">${fmt(Math.abs(r.netLots), 0)}</span></button>`).join('') || '<div class="empty">無資料</div>'}</section>
    <section class="card"><div class="card-h"><h2>分享圖卡<small>左右滑動 · 白底 9:16</small></h2></div><div class="card-b" id="flowcards">${renderFlowCards(d, { contract: F.contract, page: F.page })}</div></section>
    <div class="foot">普通股排行 · 排除 ETF／權證 · 1 張＝1,000 股 · 非交易建議</div>`;
}

/* ---------- login / setup ---------- */
// 衡析 App 圖示：深墨圓角方形＋電光青六角形（與 icon.svg 相同，由 tools/make-icons.mjs 產生）
const LOGO = `<svg class="logo" viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" rx="22" fill="#07101C"/><polygon points="50,23.6 72.86,36.8 72.86,63.2 50,76.4 27.14,63.2 27.14,36.8" fill="#2EE6FF" stroke="#2EE6FF" stroke-width="6.6" stroke-linejoin="round"/><polyline points="35.48,61.22 46.04,50 53.96,56.6 65.84,39.44" fill="none" stroke="#07101C" stroke-width="5.94" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
function showLogin() {
  document.body.innerHTML = `<form class="login" id="login">${LOGO}<h1>衡析 Pocket</h1><p>台股研究戰情室 · 手機版</p><label class="sr" for="pw">密碼</label><input id="pw" type="password" autocomplete="current-password" placeholder="輸入密碼" required minlength="10"><button class="btn primary" type="submit">登入</button><div class="err" id="login-err" role="alert"></div><div class="foot">登入後此裝置可保持 30 天。<br>密碼在電腦上執行「設定手機密碼.cmd」設定。</div></form><div id="toast"></div>`;
  $('#pw').focus();
}
function showSetup(msg) { document.body.innerHTML = `<div class="login">${LOGO}<h1>尚未完成設定</h1><p>${esc(msg)}</p></div>`; }
document.addEventListener('submit', async e => {
  if (e.target.id !== 'login') return; e.preventDefault();
  const b = e.target.querySelector('button'); b.disabled = true; $('#login-err').textContent = '';
  try { await api('auth/login', { password: $('#pw').value }); start(); }
  catch (err) { if (!err.silent) $('#login-err').textContent = err.message; b.disabled = false; }
});

/* ---------- events ---------- */
document.addEventListener('click', async e => {
  const b = e.target.closest('button,[data-id],[data-sec]'); if (!b) return;
  const ds = b.dataset;
  try {
    if ('reload' in ds) return location.reload();
    if (ds.tab) return setTab(ds.tab);
    if (ds.fview) { S.flows.view = ds.fview; draw(); return load(); }
    if (b.id === 'refresh') { if (S.tab === 'heat' && !(S.heat.live && liveOpen())) await loadHeat(S.heat.data?.date); return load(S.tab !== 'heat'); }
    if (b.id === 'settings') return openSettings();
    if (ds.setFont) { try { localStorage.setItem('pocket.font', ds.setFont); } catch { } applyFont(); draw(); return openSettings(); }
    if (ds.setTheme) { try { localStorage.setItem('pocket.theme', ds.setTheme); } catch { } applyTheme(); draw(); return openSettings(); }
    if ('gotoPush' in ds) { closeSheet(); liveState.view = 'radar'; return setTab('live'); }
    if (b.id === 'theme') { const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'; try { localStorage.setItem('pocket.theme', t); } catch { } applyTheme(); return draw(); }
    if (b.id === 'logout') { await api('auth/logout', {}); return showLogin(); }
    if ('closeSheet' in ds) return closeSheet();
    if (ds.go) { if (ds.focus) { S.heat.focus = ds.focus; S.heat.sel = null; } return setTab(ds.go); }
    if (ds.stock) return openQuote(ds.stock);
    if (ds.stockDetail) return openStock(ds.stockDetail);
    if (ds.index) return openIndex(ds.index);
    if (ds.watch) { const on = ds.on === 'true'; await api('api/watch', { id: ds.watch, on }); toast(on ? '已加入自選' : '已移除自選'); S.stocks = null; S.summary = null; loadStocks(S.tab === 'stocks').catch(() => { }); if (S.tab === 'home') load(); return openStock(ds.watch); }
    if (ds.mover) { S.moverSide = ds.mover; return draw(); }
    if (ds.boff) { const B = S.brief; B.offset = Number(ds.boff); B.section = 'all'; B.limit = 15; draw(); if (!B.news[B.offset]) return load(); return; }
    if (ds.bsec) { S.brief.section = ds.bsec; S.brief.limit = 15; return draw(); }
    if (ds.bkind) { S.brief.kind = ds.bkind; return draw(); }
    if ('bmore' in ds) { S.brief.limit += 20; return draw(); }
    if (ds.group) { S.list = { ...S.list, mode: 'all', group: ds.group, limit: 40 }; return setTab('stocks'); }
    if (ds.mode) { S.list.mode = ds.mode; S.list.limit = 40; return draw(); }
    if ('grp' in ds) { S.list.group = ds.grp; S.list.limit = 40; return draw(); }
    if (ds.sort) { S.list.sort = ds.sort; return draw(); }
    if ('moreStocks' in ds) { S.list.limit += 40; return draw(); }
    if (ds.hmarket) { S.heat.market = ds.hmarket; S.heat.focus = null; S.heat.sel = null; return draw(); }
    if (ds.upd) { const n = ds.upd === 'all' ? S.stocks?.stocks.length : null; if (ds.upd === 'all' && !confirm(tx(`更新研究名單${n ? ` ${n} 檔` : ''}全部行情？需要一段時間並使用資料源額度，可隨時按「停止」。`))) return; return startJob('api/update', { scope: ds.upd }, ds.upd === 'all' ? '更新研究名單' : '更新自選股'); }
    if (ds.updStock) return startJob('api/update', { scope: 'selected', ids: [ds.updStock] }, `更新 ${ds.updStock}`);
    if (ds.news) return startJob('api/news', { id: ds.news }, `取得 ${ds.news} 新聞`);
    if ('patUpdate' in ds) { if (!confirm(tx('更新全市場型態資料？約需數分鐘並使用資料源額度，可隨時按「停止」。'))) return; return startJob('api/pattern-update', {}, '更新型態資料'); }
    if ('jobCancel' in ds) { await api('api/cancel', {}); toast('已要求停止，資料會保留'); return pollJob(); }
    if ('hlive' in ds) { ++heatRequest; const H = S.heat; H.loading = false; H.liveBusy = false; H.live = !H.live; if (H.feed) H.feed = { ...H.feed, status: H.live ? 'waiting' : 'display-paused' }; H.error = ''; draw(); if (H.live && liveOpen()) await loadLive(); else if (H.live) toast('非盤中；開盤後每 10 秒自動更新'); return; }
    if ('heatQuery' in ds) { S.heat.live = false; const d = $('#heat-date').value || defaultHeatDate(); await loadHeat(d, true); if (!S.heat.error) toast(`已更新 ${S.heat.data.date} 熱浪圖（即時已暫停）`); return draw(); }
    if ('hback' in ds) { S.heat.focus = null; return draw(); }
    if ('hclose' in ds) { S.heat.sel = null; return draw(); }
    if (ds.hsec) { S.heat.focus = ds.hsec; S.heat.sel = null; draw(); return window.scrollTo({ top: 0, behavior: 'smooth' }); }
    if (ds.sec && b.closest('#hm')) { S.heat.focus = S.heat.focus === ds.sec ? null : ds.sec; S.heat.sel = null; return draw(); }
    if (ds.id && b.closest('#hm')) { S.heat.sel = S.heat.sel === ds.id ? null : ds.id; draw(); if (S.heat.sel) $('.hm-pick')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
    if ('pstatus' in ds) { S.patStatus = ds.pstatus; S.patLimit = 20; return draw(); }
    if ('pcat' in ds) { S.patCat = ds.pcat; S.patLimit = 20; return draw(); }
    if ('morePat' in ds) { S.patLimit += 20; return draw(); }
    if (ds.pat) return openPattern(ds.pat, ds.pid);
    if ('flowQuery' in ds || 'flowLoad' in ds) { const d = $('#flow-date').value || twToday(); await loadFlows(d, 'flowQuery' in ds); if (!S.flows.error && 'flowQuery' in ds) toast(`已取得 ${d} 法人資料`); return draw(); }
    if (ds.fmarket) { S.flows.market = ds.fmarket; return draw(); }
    if (ds.finv) { S.flows.inv = ds.finv; return draw(); }
    if (ds.fside) { S.flows.side = ds.fside; return draw(); }
    if (ds.flowImage && S.flows.data) { b.disabled = true; try { await downloadFlowCard(b, S.flows.data.date); } finally { b.disabled = false; } return; }
  } catch (err) { if (!err.silent) toast(err.message); }
});
document.addEventListener('click', e => { if (e.target.id === 'backdrop') closeSheet(); });
let qTimer;
document.addEventListener('input', e => { if (e.target.id === 'q') { clearTimeout(qTimer); qTimer = setTimeout(() => { S.list.q = e.target.value.trim(); S.list.limit = 40; if (S.list.q && S.list.mode === 'watch') S.list.mode = 'all'; const pos = e.target.selectionStart; draw(); const q = $('#q'); q.focus(); try { q.setSelectionRange(pos, pos); } catch { } }, 200); } });
document.addEventListener('change', e => {
  if (e.target.id === 'heat-cached' && e.target.value) { S.heat.focus = null; S.heat.sel = null; S.heat.live = false; loadHeat(e.target.value).then(draw); }
  if (e.target.id === 'flow-contract' || e.target.id === 'flow-strikes') {
    const F = S.flows; if (e.target.id === 'flow-contract') { F.contract = e.target.value; const c = F.data.options.contracts.find(c => c.contract === F.contract); F.page = Math.max(0, Math.floor((c?.strikes.findIndex(r => r.strike === c.callPeak) || 0) / 20)); } else F.page = Number(e.target.value);
    $('#flowcards').innerHTML = renderFlowCards(F.data, { contract: F.contract, page: F.page });
  }
});
let lastVisible = Date.now();
document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastVisible > 120000 && $('#main')) load(); if (document.hidden) lastVisible = Date.now(); });

/* ---------- 螢幕恆亮（Screen Wake Lock）：App 在前景時保持螢幕不熄滅，切到背景自動釋放、回來再取得 ---------- */
let wakeLock = null;
const wakeSupported = () => 'wakeLock' in navigator;
const wakePref = () => { try { return localStorage.getItem('pocket.wake') === '1'; } catch { return false; } };
async function applyWake() {
  if (!wakeSupported()) return;
  if (wakePref() && document.visibilityState === 'visible') {
    if (!wakeLock) { try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; refreshWakeStatus(); }); } catch { wakeLock = null; } }
  } else if (wakeLock) { try { await wakeLock.release(); } catch { } wakeLock = null; }
  refreshWakeStatus();
}
function refreshWakeStatus() { const el = $('#wake-status'); if (el) el.textContent = !wakeSupported() ? '此瀏覽器不支援' : wakeLock ? '使用中' : wakePref() ? '等待啟用' : '關閉'; }
document.addEventListener('visibilitychange', applyWake);
document.addEventListener('change', async e => { if (e.target.id !== 'wake-toggle') return; try { localStorage.setItem('pocket.wake', e.target.checked ? '1' : '0'); } catch { } await applyWake(); toast(e.target.checked ? (wakeLock ? '螢幕恆亮已開啟' : '已開啟，回到 App 畫面時生效') : '螢幕恆亮已關閉'); });

/* ---------- 設定 ---------- */
function openSettings() {
  const theme = document.documentElement.dataset.theme, perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const push = liveState.push?.state;
  openSheet('設定', `<section class="card"><div class="card-b" style="padding-top:14px">
      <div class="lv-rule"><label class="lv-sw"><input type="checkbox" id="wake-toggle" ${wakePref() ? 'checked' : ''} ${wakeSupported() ? '' : 'disabled'}><span></span></label><div><b>螢幕恆亮</b><small>開著衡析時螢幕不會自動熄滅，適合盤中盯看板或熱浪圖；切到其他 App 或鎖定後自動恢復正常。較耗電。${IOS ? '從主畫面圖示開啟時需 iOS 18.4 以上才有效。' : ''}</small><small>狀態：<span id="wake-status"></span></small></div></div>
      <div class="lv-rule"><div style="flex:1"><b>外觀</b><div class="seg" style="margin-top:8px">${[['dark', '深色'], ['light', '淺色']].map(([v, l]) => `<button class="${theme === v ? 'on' : ''}" data-set-theme="${v}">${l}</button>`).join('')}</div></div></div>
      <div class="lv-rule"><div style="flex:1"><b>字型大小</b><small>調整整個 App 的文字大小，立即套用。</small><div class="seg" style="margin-top:8px">${FONT_SIZES.map(([v, l]) => `<button class="${fontSize() === v ? 'on' : ''}" data-set-font="${v}">${l}</button>`).join('')}</div></div></div>
    </div></section>
    ${newsSettingsCard()}
    <section class="card"><div class="card-h"><h2>🔔 通知與音效</h2></div><div class="card-b">
      <p class="set-p">通知狀態：<b>${push === 'on' ? '已開啟' : perm === 'denied' ? '已封鎖' : '未開啟'}</b>　<button class="btn" data-goto-push style="min-height:34px;padding:0 12px">${push === 'on' ? '測試／管理' : '前往開啟'}</button></p>
      ${IOS ? `<p class="set-p">iPhone／iPad 需從<b>主畫面的「衡析」圖示</b>開啟才能收通知（iOS 16.4 以上；在 Safari 按「分享」→「加入主畫面」）。通知使用 iPhone 的預設提示音，網頁 App 無法另選音效：</p>
      <ol class="set-steps"><li>開啟 iPhone「設定」→「通知」→ 找到 <b>衡析</b></li><li>打開「<b>允許通知</b>」，並開啟「<b>聲音</b>」與「<b>橫幅</b>」（鎖定畫面、通知中心也一併勾選）</li><li>回到衡析，按「盤中 → 雷達 → 發送測試」確認</li></ol>
      <p class="set-p muted">專注模式或勿擾模式下不會響鈴；可在「設定 → 專注模式」把衡析加入允許的 App。</p>`
      : `<p class="set-p">通知會使用手機的系統提示音。網頁 App 無法自帶音效，但可以在三星設定中替衡析指定任何內建音效：</p>
      <ol class="set-steps"><li>開啟手機「設定」→「通知」→「應用程式通知」（或「設定」→「應用程式」→ 選 <b>衡析</b>）</li><li>點 <b>衡析</b> →「通知類別」，選擇收到通知的類別（例如「一般」）</li><li>選「<b>提醒</b>」（不要選靜音），再點「<b>聲音</b>」挑選喜歡的三星內建音效，也可以開啟震動</li><li>回到衡析，按「盤中 → 異動雷達 → 發送測試」試聽</li></ol>
      <p class="set-p muted">找不到「衡析」時，改在「Chrome」→ 通知 → 網站 → 衡析手機版的網址設定。勿擾模式下不會響鈴。</p>`}
    </div></section>
    <button class="btn block" id="logout">登出這台裝置</button>`);
  refreshWakeStatus();
}

/* ---------- 自動更新：回到前景時比對伺服器版本，有新版就重新載入 ---------- */
let buildId = null;
async function checkBuild() { try { const h = await (await fetch('/health', { cache: 'no-store' })).json(); if (buildId && h.build && h.build !== buildId && !$('#sheet')?.classList.contains('open')) location.reload(); buildId = buildId || h.build; } catch { } }
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkBuild(); });
setInterval(() => { if (!document.hidden) checkBuild(); }, 10 * 60e3);

/* ---------- boot ---------- */
checkBuild();
applyWake();
initLive({ api, toast, draw, S, openSheet, openStock, inScope, aggregate, renderTreemap, heatColor, $, $$, setTab, twToday, openChips });
initChips({ api, toast, draw, S });
// 推播或雷達中的分點追蹤／大戶週報：開啟籌碼分頁對應的檢視
function openChips(view) { S.flows.view = view; if (S.tab === 'flows') { draw(); load(); } else setTab('flows'); }
// Nexus 的研究市場、介面語言、漲跌配色與可用功能
function applyProfile(p) { if (!p) return; S.profile = p; MK.setMarket(p.market, p.upColor, p.language); if (p.language && p.language !== getLanguage()) setLanguage(p.language); }
async function start() {
  try { const h = await (await fetch('/health', { cache: 'no-store' })).json(); if (h.lang && h.lang !== getLanguage()) await setLanguage(h.lang); } catch { }
  let me; try { me = await api('auth/me'); applyProfile(me.profile); } catch (e) { if (!e.silent) { document.body.innerHTML = `<div class="login">${LOGO}<h1>無法連線</h1><p>${esc(e.message)}</p><button class="btn primary" data-reload>重試</button></div>`; } return; }
  shell(); setTab((location.hash || '#brief').slice(1), false); history.replaceState({ tab: S.tab }, '', '#' + S.tab);
}
start();
