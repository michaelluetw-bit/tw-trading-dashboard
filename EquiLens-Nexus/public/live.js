import { boardFeedNotice, snapshotErrorNotice, quoteProviderName, boardUnavailableLabel, boardRequestFailed, createBoardLoader } from './quote-source.js';
// 衡析 Nexus：盤中雷達頁（族群／自選即時看板＋異動雷達＋雷達設定）、個股 K 線視窗、桌面通知、新聞推播、個股籌碼深度、AI 盤後日報與排程設定。
import { esc, fmt, pct, cls, sparkSVG, candleSVG, brokerHTML, holderHTML, warrantHTML, warrantBrokersHTML, alertRow, alertMatch, isMove, ALERT_GROUPS, reportHTML, priceRuleForm, priceRulesHTML, priceRuleBody } from './insight-ui.js';
import { t, tx, translateTree } from './i18n.js';
import * as MK from './market.js';
import { initDaytrade, loadDaytrade, daytradePanel } from './daytrade.js';
import { intradaySVG, readAt, legendHTML, bookHTML, tapeHTML } from './intraday.js';
// 桌面通知的標題與內文依介面語言翻譯
const Note = (title, o = {}) => new Notification(tx(title), { ...o, body: o.body ? tx(o.body) : o.body });

let C = null; // { api, toast, state, redraw, page, openStock, inScope }
const pref = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } }, savePref = (k, v) => { try { localStorage.setItem(k, v); } catch { } };
const L = { board: null, bgroup: pref('nexus.boardGroup', ''), bsort: pref('nexus.boardSort', 'default'), alerts: [], latest: 0, date: '', group: 'all', monitor: null, draft: null, report: null, reportLoaded: false, notify: false, error: '', rules: null };
export function initLive(ctx) {
  C = ctx; try { L.notify = localStorage.getItem('nexus.notify') === '1' && Notification.permission === 'granted'; } catch { }
  initDaytrade({ api: ctx.api, toast: ctx.toast, repaint: () => repaint(), isLive: () => C.page() === 'live', openChart: id => openChart(id, 'live') });
  refreshMonitor().then(() => { if (newsOn()) loadAlerts(!L.date); }); // 新聞推播開啟時，不論在哪一頁都要接收新聞
}
const marketOpen = () => MK.isOpen();

const elapsed = s => MK.elapsed(s);
const yi = v => v == null ? '—' : fmt(v / 1e8, Math.abs(v) >= 1e10 ? 0 : 1);
const content = () => document.getElementById('pagecontent');
function repaint() { if (C.page() === 'live' && content() && !document.querySelector('dialog[open]')) content().innerHTML = livePage(); }

/* ---------- data & polling ---------- */
const loadBoard = createBoardLoader({group:()=>L.bgroup,request:want=>C.api('board?group='+encodeURIComponent(want)),today:()=>MK.today(),receive:b=>{L.board=b;L.error='';},fail:e=>{L.board=boardRequestFailed(L.board);L.error=e.message;}});
let alertsBusy = null;
function loadAlerts(reset = false) { if (!alertsBusy) alertsBusy = fetchAlerts(reset).finally(() => { alertsBusy = null; renderPip(); }); return alertsBusy; }
async function fetchAlerts(reset) {
  try {
    // 盤中看當天；非盤中顯示最近一個有紀錄的日子（例如週末顯示週五；開啟新聞推播時，半夜的新聞也會開新的一天）
    const dateQ = marketOpen() ? '' : reset || !L.date || newsOn() ? '&date=latest' : `&date=${L.date}`, before = L.latest;
    let r = await C.api('alerts?since=' + (reset ? 0 : L.latest) + dateQ);
    if (!reset && L.date && r.date !== L.date) r = await C.api('alerts?since=0&date=' + r.date); // 換日：取新一天的全部事件
    const fresh = reset ? [] : r.alerts.filter(a => a.seq > before);
    if (reset || r.date !== L.date) { L.alerts = r.alerts; L.date = r.date; } else L.alerts.push(...r.alerts);
    L.latest = Math.max(L.latest, r.latest || 0);
    if (fresh.length) notifyFresh(fresh);
  } catch (e) { L.error = e.message; }
}
async function loadMonitor() { try { L.monitor = await C.api('monitor'); L.draft = structuredClone({ monitor: L.monitor.enabled, radar: L.monitor.radar }); } catch (e) { L.error = e.message; } }
async function refreshMonitor() { try { const m = await C.api('monitor'); L.monitor = m; if (!L.draft) L.draft = structuredClone({ monitor: m.enabled, radar: m.radar }); } catch { } } // 不覆蓋編輯中的雷達設定
const newsOn = () => !!L.monitor?.news?.enabled;
export async function enterLive() { await Promise.all([loadBoard(), loadAlerts(!L.date), loadMonitor(), loadDaytrade(), loadRules()]); repaint(); }
/* ---------- 自訂提醒 ---------- */
async function loadRules() { try { L.rules = await C.api('price-alerts'); } catch (e) { L.error = e.message; } }
// 重畫所有顯示提醒的區塊（盤中雷達頁、個股診斷、K 線視窗），不整頁重繪以免清掉輸入中的表單
function paintRules() {
  for (const el of document.querySelectorAll('[data-pa-box]')) el.innerHTML = priceRulesHTML(L.rules, { stockId: el.dataset.paBox || null, empty: el.dataset.paBox ? '這檔股票尚未設定提醒' : '尚未設定提醒。在下方輸入股票代號與條件，或在個股視窗設定。' });
  const n = document.getElementById('pa-count'); if (n) n.textContent = `${(L.rules?.rules || []).filter(r => r.active).length} / ${L.rules?.max || 200}`;
}
function rulesSection(stock) {
  if (!L.rules) loadRules().then(paintRules);
  return `<section class="panel ix-pa"><div class="panelhead"><h3>🔔 自訂提醒</h3><span class="fine">條件成立時推播到手機、跳桌面通知</span></div><div class="contentpad"><div data-pa-box="${esc(stock.id)}">${L.rules ? priceRulesHTML(L.rules, { stockId: stock.id, empty: '這檔股票尚未設定提醒' }) : '<p><i class="spinner"></i></p>'}</div>${priceRuleForm(stock)}</div></section>`;
}
let tick = 0;
setInterval(async () => {
  if (!C || document.hidden) return; tick++;
  const onPage = C.page() === 'live';
  if (tick % 30 === 0 && !onPage) await refreshMonitor(); // 每 5 分鐘同步一次（例如手機改了新聞推播開關）
  if (marketOpen() || newsOn() || (onPage && tick % 6 === 0)) {
    await Promise.all([onPage ? loadBoard() : null, L.date || onPage || newsOn() ? loadAlerts(!L.date) : null]);
    if (onPage) repaint();
  } else if (!L.date && L.notify) await loadAlerts(true);
  if (C.page() === 'settings' && document.getElementById('news-status')) { await refreshMonitor(); const el = document.getElementById('news-status'); if (el) el.innerHTML = newsStatusHTML(); }
  if (C.page() === 'home' && L.report?.busy) { await loadReport(); C.redraw(); }
  if (onPage && marketOpen() && tick % 3 === 0) await refreshMonitor(); // 盤中每 30 秒確認即時推播狀態
  if (marketOpen() && tick % 3 === 0 && document.querySelector('[data-pa-box]') && !document.activeElement?.closest?.('[data-pa-form]')) { await loadRules(); paintRules(); } // 觸發後停用的單次提醒
}, 10000);
// 即時推播（例如富果 WebSocket）運作時：盤中雷達頁的異動每 3 秒更新；Shioaji 看板共用推播快取；開著桌面通知時，異動也每 3 秒取一次
const streamOn = () => L.board?.provider==='shioaji' || !!L.monitor?.stream?.active;
setInterval(async () => {
  if (!C || document.hidden || !streamOn() || !marketOpen()) return;
  const onPage = C.page() === 'live';
  if (!onPage && !L.notify) return;
  await Promise.all([onPage&&L.board?.provider==='shioaji'?loadBoard():null,loadAlerts(!L.date)]);
  if (onPage) repaint();
}, 3000);
/* ---------- 浮動雷達視窗（Document Picture-in-Picture：永遠浮在最上層；不支援時改用一般彈出視窗） ---------- */
let pipWin = null, pipTimer = null, pipSeen = 0;
const P = { group: 'all', sound: (() => { try { return localStorage.getItem('nexus.pipSound') === '1'; } catch { return false; } })() };
const PIP_GROUPS = [['all', '全部'], ['watch', '自選'], ['price', '價格'], ['news', '新聞']];
const alertDayLabel = () => { const today = MK.today(); return L.date && L.date !== today ? `${Number(L.date.slice(5, 7))}/${Number(L.date.slice(8))} ` : ''; };
const pipMatch = a => a.type !== 'report' && (P.group === 'all' || (P.group === 'watch' && a.watch) || (P.group === 'price' && (a.type.startsWith('surge') || a.type.startsWith('limit'))) || (P.group === 'news' && a.type === 'news'));
async function openPip() {
  if (pipWin && !pipWin.closed) { pipWin.focus(); return; }
  let docPip = 'documentPictureInPicture' in window;
  if (docPip) { try { pipWin = await window.documentPictureInPicture.requestWindow({ width: 400, height: 560 }); } catch { docPip = false; } }
  if (!docPip) pipWin = window.open('', 'equilens-radar', 'popup,width=400,height=560');
  if (!pipWin) throw new Error('瀏覽器擋下了彈出視窗，請允許此網站開啟彈出視窗');
  await mountPip(pipWin);
  if (!docPip) C.toast('此瀏覽器不支援置頂浮動視窗，已改用一般視窗（建議使用 Chrome 或 Edge）');
}
// 把雷達清單掛到指定視窗（浮動視窗、彈出視窗或測試用 iframe）
export async function mountPip(win) {
  pipWin = win; const d = win.document;
  d.title = '衡析 · 異動雷達';
  for (const sheet of document.styleSheets) { try { const s = d.createElement('style'); s.textContent = [...sheet.cssRules].map(r => r.cssText).join('\n'); d.head.append(s); } catch { if (sheet.href) { const l = d.createElement('link'); l.rel = 'stylesheet'; l.href = sheet.href; d.head.append(l); } } }
  for (const k of ['theme', 'glow', 'motion']) if (document.documentElement.dataset[k]) d.documentElement.dataset[k] = document.documentElement.dataset[k];
  d.documentElement.style.fontSize = document.documentElement.style.fontSize;
  d.body.className = 'pip-body';
  d.body.innerHTML = '<div class="pip"><header class="pip-h"></header><div class="ix-alerts pip-list" id="pip-list"></div></div>';
  d.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.pipGroup) { P.group = b.dataset.pipGroup; pipSeen = 0; return renderPip(true); }
    if (b.dataset.pipSound != null) { P.sound = !P.sound; try { localStorage.setItem('nexus.pipSound', P.sound ? '1' : '0'); } catch { } if (P.sound) beep(); return renderPip(true); }
    if (b.dataset.alertStock) { window.focus(); const id = b.dataset.alertStock; try { await openChart(id, 'live'); } catch (err) { C.toast(err.message); } }
  });
  pipWin.addEventListener('pagehide', () => { pipWin.clearInterval?.(pipTimer); pipWin = null; pipTimer = null; });
  pipSeen = 0; renderPip(true);
  pipTimer = pipWin.setInterval(() => { if (marketOpen() || !L.date) loadAlerts(!L.date); else renderPip(); }, 10000); // 計時器屬於浮動視窗本身，主視窗縮小也不會被降頻
  await loadAlerts(!L.date);
}
function beep() {
  try { const ctx = new (pipWin?.AudioContext || AudioContext)(), o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(880, ctx.currentTime); o.frequency.setValueAtTime(1320, ctx.currentTime + .09); g.gain.setValueAtTime(.0001, ctx.currentTime); g.gain.exponentialRampToValueAtTime(.18, ctx.currentTime + .02); g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + .28); o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + .3); } catch { }
}
function renderPip(full = false) {
  if (!pipWin || pipWin.closed) return;
  const d = pipWin.document, list = L.alerts.filter(pipMatch).slice(-60).reverse(), newest = list[0]?.seq || 0, open = marketOpen();
  const head = d.querySelector('.pip-h');
  if (full || head.dataset.k !== `${P.group}${P.sound}`) {
    head.dataset.k = `${P.group}${P.sound}`;
    head.innerHTML = `<div class="pip-t"><b>📡 異動雷達</b><span class="pip-st" id="pip-st"></span></div><div class="pip-tools"><div class="segmented">${PIP_GROUPS.map(([k, l]) => `<button class="${P.group === k ? 'selected' : ''}" data-pip-group="${k}">${l}</button>`).join('')}</div><button class="pip-snd" data-pip-sound title="新異動提示音">${P.sound ? '🔔' : '🔕'}</button></div>`;
  }
  d.getElementById('pip-st').innerHTML = `<span class="pulse ${open ? '' : 'off'}"></span>${open ? '盤中監控' : '非盤中'} · ${alertDayLabel()}${L.alerts.filter(isMove).length} 則${L.alerts.some(a => a.type === 'news') ? ` · 新聞 ${L.alerts.filter(a => a.type === 'news').length}` : ''}`;
  const fresh = pipSeen && newest > pipSeen;
  d.getElementById('pip-list').innerHTML = list.map(a => alertRow(a).replace('class="ix-alert', `class="ix-alert${pipSeen && a.seq > pipSeen ? ' pip-new' : ''}`)).join('') || `<div class="empty"><p>${open ? '目前沒有符合條件的異動' : '今日尚無異動紀錄，開盤後自動更新'}</p></div>`;
  translateTree(d.body); // 浮動視窗是另一份文件，不在自動翻譯的監看範圍內
  if (fresh && P.sound) beep();
  pipSeen = Math.max(pipSeen, newest) || pipSeen;
  if (!pipSeen && newest) pipSeen = newest;
}
// 新事件提醒：雷達異動與日報走桌面通知；新聞在桌面通知開啟時跳桌面通知，未開啟時在頁面內彈窗（夜間勿擾時段不提醒）
function notifyFresh(list) {
  const news = list.filter(a => a.type === 'news' && !a.quiet), rest = list.filter(a => a.type !== 'news');
  if (L.notify && rest.length) notifyDesktop(rest);
  if (!news.length) return;
  if (L.notify) {
    const show = news.length <= 3 ? news.map(a => [`🗞️ ${a.name} ${a.stockId}`, `${a.detail}${a.source ? `（${a.source}）` : ''}`, a.url, `news:${a.seq}`]) : [[`🗞️ 個股新聞 ${news.length} 則`, news.slice(0, 5).map(a => `${a.name}：${a.detail}`).join('\n'), '', 'news-batch']];
    for (const [title, body, url, tag] of show) { try { const n = Note(title, { body, tag, icon: '/favicon.svg' }); n.onclick = () => { window.focus(); if (url) window.open(url, '_blank', 'noopener'); else C.setPage('live'); n.close(); }; } catch { } }
  } else C.toast(news.length === 1 ? `🗞️ ${news[0].name}：${news[0].detail}` : `🗞️ ${news.length} 則個股新聞：${news.slice(0, 3).map(a => a.name).join('、')}${news.length > 3 ? '…' : ''}（盤中雷達 → 新聞）`);
}
function notifyDesktop(list) {
  const items = list.filter(a => a.type === 'report' || a.watch || list.length <= 4).slice(0, 4);
  for (const a of items) { try { Note(a.type === 'report' ? '📰 AI 盤後日報' : !a.stockId ? `⏰ ${a.title}` : `${a.name} ${a.stockId} ${a.title}`, { body: a.type === 'report' || !a.stockId ? a.detail : `${a.close}（${pct(a.change)}）· ${a.detail}`, tag: `${a.type}:${a.stockId}`, icon: '/favicon.svg' }); } catch { } }
  if (list.length > items.length) try { Note(`📡 盤中雷達：${list.length} 則異動`, { body: list.slice(0, 6).map(a => `${a.name}${a.title}`).join('、'), tag: 'radar-batch', icon: '/favicon.svg' }); } catch { }
}

/* ---------- 即時看板：自選或研究總覽任一族群 ---------- */
const BOARD_SORTS = [['default', '預設'], ['chg', '漲幅'], ['amt', '成交值']];
const chgOf = s => s.status ? s.quote?.change : s.quote?.change ?? s.daily?.change;
function sortStocks(list) {
  if (L.bsort === 'chg') return list.slice().sort((a, b) => (chgOf(b) ?? -1e9) - (chgOf(a) ?? -1e9));
  if (L.bsort === 'amt') return list.slice().sort((a, b) => (b.quote?.amount || 0) - (a.quote?.amount || 0));
  return list;
}
function boardGroupBar(b) {
  if (!b?.groups) return '';
  const chips = `<button class="${b.group === 'watch' ? 'selected' : ''}" data-bgroup="watch">☆ 自選 <b class="mono">${b.watchCount}</b></button>` + b.groups.map(g => `<button class="${b.group === g.id ? 'selected' : ''}" data-bgroup="${esc(g.id)}" title="${esc(g.name)} · ${g.count} 檔${g.rank ? ` · 族群排名第 ${g.rank}` : ''}">${esc(g.name)} <b class="mono ${cls(g.score)}">${g.score == null ? '—' : pct(g.score)}</b></button>`).join('');
  const g = b.groups.find(x => x.id === b.group), up = b.stocks.filter(s => chgOf(s) > 0).length, down = b.stocks.filter(s => chgOf(s) < 0).length;
  const sum = g ? `<b>${esc(g.name)}</b> · ${g.count} 檔 · 量能加權 <b class="mono ${cls(g.score)}">${pct(g.score)}</b> · 上漲 <span class="up mono">${g.up}</span>／下跌 <span class="down mono">${g.down}</span> · 成交 <span class="mono">${yi(g.amount)}</span> 億${g.rank ? ` · 族群排名第 <b class="mono">${g.rank}</b> / ${b.groups.filter(x => x.rank).length}` : ''}`
    : `<b>自選</b> · ${b.stocks.length} 檔 · 上漲 <span class="up mono">${up}</span>／下跌 <span class="down mono">${down}</span>`;
  return `<div class="lv-chips lv-gchips">${chips}</div><div class="lv-gsum">${sum}</div>`;
}
function boardCards(b) {
  if (!b || b.loading) return '<div class="empty"><i class="spinner"></i>讀取中…</div>';
  if (!b.stocks.length) return b.group === 'watch' ? '<div class="empty"><h3>尚無自選股</h3><p>在研究總覽點 ☆ 加入自選，或在上方切換到任一族群看板。</p></div>' : '<div class="empty"><p>此族群沒有成分股。</p></div>';
  return `<div class="lv-grid">${sortStocks(b.stocks).map(s => {
    const q = s.quote, chg = chgOf(s), price = b.provider==='shioaji' ? q?.close : q?.close ?? s.daily?.price;
    const ratio = q?.volume && q?.yesterdayVolume && elapsed(q.time) >= 5 ? q.volume / (elapsed(q.time) / MK.sessionLength()) / q.yesterdayVolume : null;
    // 外盤比（即時推播才有）：外盤成交量 ÷（內盤＋外盤），高代表買方積極
    const outer = q?.volumeAtAsk != null && q?.volumeAtBid != null && q.volumeAtAsk + q.volumeAtBid > 0 ? q.volumeAtAsk / (q.volumeAtAsk + q.volumeAtBid) * 100 : null;
    return `<button class="lv-card ${cls(chg)}" data-kbar="${s.id}"><div class="lv-top"><strong>${esc(s.name)} <span class="stockcode">${s.id}</span></strong>${s.score != null ? `<span class="tag ${s.score >= 75 ? 'amber' : 'cyan'}">${fmt(s.score)}</span>` : ''}</div>
    <div class="lv-px"><span class="mono ${cls(chg)}">${fmt(price, 2)}</span><span class="mono ${cls(chg)}">${pct(chg)}</span></div>${sparkSVG(s.spark, s.prev, { w: 200, h: 46, xs: s.sparkX })}
    <div class="lv-meta mono">${b.provider==='shioaji'?`<span>${q?`Shioaji ${esc(q.time)}`:esc(boardUnavailableLabel(s.status))}</span>`:''}<span>${q?.volume ? `${fmt(q.volume)} ${MK.unit()}` : q?.time ? `收盤 ${q.time}` : s.daily?.asOf ? `日資料 ${s.daily.asOf.slice(5)}` : '—'}</span><span>${q?.amount ? `${yi(q.amount)} 億` : ''}</span><span class="${ratio >= 2 ? 'up' : ''}">${ratio ? `量比 ${fmt(ratio, 1)}` : ''}</span>${outer != null ? `<span class="${outer >= 60 ? 'up' : outer <= 40 ? 'down' : ''}" title="外盤成交量占內外盤合計">外盤 ${fmt(outer, 0)}%</span>` : ''}</div></button>`;
  }).join('')}</div>`;
}

/* ---------- 盤中雷達頁 ---------- */
// 即時推播狀態（雷達與看板）：檔數、方案上限、錯誤
function streamText(st) {
  if (!st?.capable) return '';
  if (st.active) return `<span> · ⚡ 雷達即時推播 <b class="mono">${fmt(st.symbols)}</b> 檔</span>${st.total > st.symbols ? `<span>（方案上限 ${fmt(st.limit)} 檔，自選優先）</span>` : ''}`;
  return st.error ? `<span> · 即時推播未連線：${esc(st.authFailed ? '金鑰無效或方案不支援（10 分鐘後重試）' : st.error === 'no-heartbeat' ? '連線逾時，重新連線中' : st.error)}</span>` : '<span> · 即時推播連線中…</span>';
}
export function livePage() {
  const m = L.monitor, open = marketOpen(), b = L.board;
  const status = `<div class="notice"><span><span class="pulse ${open && m?.enabled ? '' : 'off'}"></span> ${!m ? '讀取中…' : !m.enabled ? '盤中監控已關閉' : open ? `盤中監控中 · 行情時間 <b class="mono">${esc(b?.asOf?.slice(11, 19) || '—')}</b> · 每 ${b?.provider==='shioaji'?3:10} 秒` + (b?.feed?'':streamText(m?.stream)) : `非盤中 · 平日 ${MK.market().sessions?.[0]?.[0] || ''} 自動開始`} · ${alertDayLabel() || '今日'}異動 <b class="mono">${L.alerts.filter(isMove).length}</b> 則${m?.news?.enabled ? ` · 🗞️ 新聞 <b class="mono">${L.alerts.filter(a => a.type === 'news').length}</b> 則` : ''}</span><span class="actions"><button data-live="pip" title="開啟永遠置頂的浮動雷達視窗">🪟 浮動雷達視窗</button><button data-live="notify">${L.notify ? '🔔 桌面通知：開' : '🔕 開啟桌面通知'}</button></span></div>`;
  const list = L.alerts.filter(a => alertMatch(a, L.group)).slice().reverse();
  const radar = `<div class="lv-chips">${ALERT_GROUPS.map(([k, l]) => `<button class="${L.group === k ? 'selected' : ''}" data-agroup="${k}">${l} <b class="mono">${L.alerts.filter(a => alertMatch(a, k)).length}</b></button>`).join('')}</div><div class="ix-alerts">${list.map(alertRow).join('') || `<div class="empty"><p>${open ? '目前沒有符合條件的異動。' : '今日尚無異動紀錄。'}</p></div>`}</div>`;
  const sorts = `<div class="segmented" title="卡片排序">${BOARD_SORTS.map(([v, l]) => `<button class="${L.bsort === v ? 'selected' : ''}" data-bsort="${v}">${l}</button>`).join('')}</div>`;
  return `${status}${boardFeedNotice(b?.feed)}${snapshotErrorNotice(m)}${L.error ? `<div class="notice err"><span>${esc(L.error)}</span></div>` : ''}${daytradePanel()}<div class="lv-layout"><section class="panel"><div class="panelhead"><div><h2><span class="idx">01</span>即時看板</h2><p>切換自選或研究總覽族群 · 盤中每 ${b?.provider==='shioaji'?3:10} 秒更新 · 虛線為昨收 · 點卡片看日 K／5 分 K</p></div>${sorts}</div>${boardGroupBar(b)}<div class="contentpad">${boardCards(b)}</div></section>
  <aside class="rightcol"><section class="panel"><div class="panelhead"><div><h2><span class="idx">02</span>異動雷達</h2><p>爆量 · 急拉急殺 · 漲跌停 · 型態進場 · 跌破防守 · 自訂提醒</p></div></div>${radar}</section>${rulesPanel()}${settingsPanel()}</aside></div>`;
}
function rulesPanel() {
  return `<section class="panel ix-pa"><div class="panelhead"><div><h2><span class="idx">03</span>自訂提醒 <small class="mono fine" id="pa-count">${(L.rules?.rules || []).filter(r => r.active).length} / ${L.rules?.max || 200}</small></h2><p>價位 · 漲跌幅 · 量能 · 條件成立時推播 · 盤中監控執行時生效</p></div></div><div class="contentpad"><div data-pa-box="">${priceRulesHTML(L.rules, { empty: '尚未設定提醒。在下方輸入股票代號與條件，或在個股視窗設定。' })}</div>${priceRuleForm()}</div></section>`;
}
function settingsPanel() {
  const d = L.draft; if (!d) return '';
  const r = d.radar, get = p => p.split('.').reduce((o, k) => o[k], r);
  const sel = (p, opts, unit = '') => `<select data-rset="${p}">${opts.map(v => `<option value="${v}" ${String(get(p)) === String(v) ? 'selected' : ''}>${v === 0 ? '不限' : v >= 1e7 ? fmt(v / 1e8, 1) + ' 億' : v + unit}</option>`).join('')}</select>`;
  const row = (p, label, extra = '') => `<label class="lv-rule"><input type="checkbox" data-rset="${p}" ${(p === 'monitor' ? d.monitor : get(p)) ? 'checked' : ''}><span>${label}</span>${extra ? `<span class="lv-opts">${extra}</span>` : ''}</label>`;
  return `<section class="panel"><div class="panelhead"><div><h2><span class="idx">04</span>雷達設定</h2><p>手機版同步共用 · 行情請求量依資料來源而異</p></div></div><div class="contentpad lv-settings">
    ${row('monitor', `盤中監控（${MK.market().sessions?.[0]?.[0] || ''}–${MK.market().sessions?.at(-1)?.[1] || ''}）`)}
    <div class="segmented" style="margin:10px 0">${[['watch', '只看自選'], ['research', '自選＋研究名單'], ['all', '全市場']].map(([v, l]) => `<button class="${r.scope === v ? 'selected' : ''}" data-rscope="${v}">${l}</button>`).join('')}</div>
    ${row('volume.on', '🔥 爆量', `預估量 ≥ ${sel('volume.ratio', [1.5, 2, 3, 5], ' 倍')} 昨量，成交 ≥ ${sel('volume.minAmount', [0, 50000000, 100000000, 500000000])}`)}
    ${row('surge.on', '🚀 急拉／⚡ 急殺', `${sel('surge.minutes', [1, 3, 5, 10, 15], ' 分')} 內漲（跌）幅 ≥ ${sel('surge.pct', [1, 1.5, 2, 3, 5], '%')}（以昨收計算，含門檻）`)}
    ${row('limit.on', '🔺 漲跌停 觸及／打開／再鎖')}
    ${row('pattern.on', '🎯 型態股站上進場價')}
    ${row('stop.on', '🛑 跌破結構防守')}
    <div class="form-actions"><button class="primary" data-rsave>儲存雷達設定</button></div></div></section>`;
}
/* ---------- 個股 K 線視窗：日 K／5 分 K（5MA、20MA），盤中每 10 秒更新即時報價與 K 線 ---------- */
const K = { id: null, period: ['day', 'live'].includes(pref('nexus.chartPeriod', 'live')) ? pref('nexus.chartPeriod', 'live') : '5m', data: null, live: null, error: '', seq: 0, group: '' };
const md = d => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const chartShown = id => document.getElementById('detail-dialog')?.open && !!document.querySelector(`#detail [data-chart="${id}"]`);
export async function openChart(id, period = K.period) {
  const dialog = document.getElementById('detail-dialog');
  if (K.id !== id) { K.data = null; K.live = null; K.error = ''; K.group = ''; }
  K.id = id; K.period = period; savePref('nexus.chartPeriod', period);
  if (!dialog.open) dialog.showModal();
  paintChart(); await refreshChart();
}
async function refreshChart() {
  const id = K.id, period = K.period, seq = ++K.seq;
  try {
    if (period === 'live') { const d = await C.api(`intraday?id=${id}${K.group ? '&group=' + encodeURIComponent(K.group) : ''}`); if (seq !== K.seq) return; K.live = d; K.error = ''; }
    else { const d = await C.api(`chart?id=${id}&period=${period}`); if (seq !== K.seq) return; K.data = d; K.error = ''; }
  }
  catch (e) { if (seq !== K.seq) return; K.error = e.message; }
  if (chartShown(id)) paintChart();
}
setInterval(() => { if (K.id && K.period !== 'live' && marketOpen() && !document.hidden && chartShown(K.id)) refreshChart(); }, 10000);
setInterval(() => { if (K.id && K.period === 'live' && marketOpen() && !document.hidden && chartShown(K.id)) refreshChart(); }, 3000);
function paintChart() {
  if (K.period === 'live') return paintLive();
  const box = document.getElementById('detail'), id = K.id, d = K.data?.id === id ? K.data : null, s = L.board?.stocks.find(x => x.id === id);
  const ready = d && d.period === K.period, q = d?.quote ?? s?.quote, dayBar = d?.session || null;
  const price = q?.close ?? dayBar?.[4] ?? d?.daily?.price ?? s?.daily?.price, chg = q?.change ?? d?.daily?.change ?? s?.daily?.change;
  const live = d?.live && marketOpen(), stamp = live ? `<span class="tag cyan"><span class="pulse"></span> 盤中 · 每 10 秒更新 · <b class="mono">${esc(q?.time || '')}</b></span>` : q?.date ? `<span class="tag">${esc(md(q.date))} ${esc(q.time || '')}</span>` : '';
  const info = [q?.open ?? dayBar?.[1], q?.high ?? dayBar?.[2], q?.low ?? dayBar?.[3]];
  const caption = !ready ? '' : d.period === 'day' ? `日 K（不還原）· 顯示最近 ${Math.min(120, d.bars.length)} 個交易日${d.today ? ` · 最後一根為 ${md(d.today)} ${live ? '即時' : '當日'}資料` : ''} · 均線以收盤價計算`
    : `${d.notice ? `<span class="amber">⚠ ${esc(d.notice)}</span><br>` : ''}5 分 K · ${d.days.map(x => md(x.date)).join('、')}${d.days.some(x => x.source === 'replay') ? ' · 盤中以每分鐘快照組成（高低點為近似值），收盤後自動改用 FinMind 分 K' : ' · FinMind 分 K'} · 均線跨日連續計算`;
  box.innerHTML = `<div class="detailtop" data-chart="${id}"><div><p class="eyebrow">${K.period === 'day' ? 'Daily' : '5-Minute'} K · MA5 / MA20 ${stamp}</p><h2>${esc(d?.name || s?.name || id)} <span class="stockcode">${id}</span></h2>
    <div class="price">${fmt(price, 2)} <span class="${cls(chg)}" style="font-size:1rem">${pct(chg)}${q?.changePrice != null ? ` · ${q.changePrice > 0 ? '+' : ''}${fmt(q.changePrice, 2)}` : ''}</span></div>
    <p class="mono">開 ${fmt(info[0], 2)} · 高 ${fmt(info[1], 2)} · 低 ${fmt(info[2], 2)}${q?.volume ? ` · 成交 ${fmt(q.volume)} 張` : dayBar ? ` · 成交 ${fmt(dayBar[5])} 張` : ''}${q?.amount ? ` · ${yi(q.amount)} 億` : ''}${q?.bid ? ` · 委買 ${fmt(q.bid, 2)} / 委賣 ${fmt(q.ask, 2)}` : ''}</p></div>
    <div class="actions"><div class="segmented">${CHART_TABS.map(([v, l]) => `<button class="${K.period === v ? 'selected' : ''}" data-cperiod="${v}">${l}</button>`).join('')}</div>${C.inScope(id) ? `<button data-stock-detail="${id}">個股診斷 ↗</button>` : ''}<button class="close" data-action="close-detail" aria-label="關閉">×</button></div></div>
    <div class="detailbody"><section class="chartpanel">${K.error && !ready ? `<div class="empty"><p>${esc(K.error)}</p></div>` : ready ? candleSVG(d.bars, { w: 960, h: 400, show: d.period === 'day' ? 120 : 162, period: d.period, key: id + d.period, prev: d.prev, prevs: d.days ? Object.fromEntries(d.days.map(x => [x.date, x.prev])) : null }) : `<div class="empty"><p><i class="spinner"></i>讀取${K.period === 'day' ? '日' : ' 5 分'} K…</p></div>`}<p class="chartcaption">${caption}</p></section>${rulesSection({ id, name: d?.name || s?.name || id, close: price })}</div>`;
}

/* ---------- 個股即時走勢（K 線視窗的「走勢」分頁）：全日走勢、當日均價線、族群均價線、五檔、成交明細，盤中每 3 秒更新 ---------- */
const CHART_TABS = [['live', '走勢'], ['5m', '5分K'], ['day', '日K']];
function paintLive() {
  const box = document.getElementById('detail'), id = K.id, d = K.live?.id === id ? K.live : null, s = L.board?.stocks.find(x => x.id === id);
  const q = d?.quote || {}, price = q.last ?? s?.quote?.close, chg = q.change ?? s?.quote?.change, live = d?.live && marketOpen();
  const stamp = live ? `<span class="tag cyan"><span class="pulse"></span> ${d.source === 'stream' ? '即時推播' : '盤中'} · 每 3 秒更新 · <b class="mono">${esc(q.time || '')}</b></span>` : d?.date ? `<span class="tag">${esc(md(d.date))} ${esc(q.time || '')}</span>` : '';
  const chart = K.error && !d ? `<div class="empty"><p>${esc(K.error)}</p></div>` : d ? `${legendHTML(d)}${intradaySVG(d, { w: 960, h: 420 })}<p class="fine" id="ia-read">${d.minutes?.m?.length ? '滑鼠移到圖上查看每分鐘價格、均價與族群均價' : ''}</p>${d.group?.choices?.length > 1 ? `<div class="segmented">${d.group.choices.map(x => `<button class="${x.id === d.group.id ? 'selected' : ''}" data-igroup="${esc(x.id)}">${esc(x.name)}</button>`).join('')}</div>` : ''}` : '<div class="empty"><p><i class="spinner"></i>讀取走勢…</p></div>';
  box.innerHTML = `<div class="detailtop" data-chart="${id}"><div><p class="eyebrow">Intraday · VWAP / Group VWAP ${stamp}</p><h2>${esc(d?.name || s?.name || id)} <span class="stockcode">${id}${d?.group ? ' · ' + esc(d.group.name) : ''}</span></h2>
    <div class="price">${fmt(price, 2)} <span class="${cls(chg)}" style="font-size:1rem">${pct(chg)}${q.changePrice != null ? ` · ${q.changePrice > 0 ? '+' : ''}${fmt(q.changePrice, 2)}` : ''}</span></div>
    <p class="mono">開 ${fmt(q.open, 2)} · 高 ${fmt(q.high, 2)} · 低 ${fmt(q.low, 2)} · 總量 ${fmt(q.volume)} 張${q.lastSize != null ? ` · 單量 ${fmt(q.lastSize)}` : ''} · 均價 <span class="amber">${fmt(q.vwap, 2)}</span></p></div>
    <div class="actions"><div class="segmented">${CHART_TABS.map(([v, l]) => `<button class="${K.period === v ? 'selected' : ''}" data-cperiod="${v}">${l}</button>`).join('')}</div>${C.inScope(id) ? `<button data-stock-detail="${id}">個股診斷</button>` : ''}<button class="close" data-action="close-detail" aria-label="關閉">×</button></div></div>
    <div class="detailbody"><section class="chartpanel">${chart}<p class="fine">均價＝當日累計成交金額 ÷ 累計成交量；族群均價＝所屬族群各股均價相對參考價的漲跌幅，以成交金額加權後換算到本股價位。</p></section>
    <div class="ia-pc"><section class="panel"><div class="panelhead"><h3>五檔</h3></div><div class="contentpad">${d ? bookHTML(d) : ''}</div></section><section class="panel"><div class="panelhead"><h3>成交明細</h3></div><div class="contentpad">${d ? tapeHTML(d) : ''}</div></section></div></div>`;
}
document.addEventListener('mousemove', e => {
  const hit = e.target.closest?.('#detail [data-intra-hit]'); if (!hit || !K.live) return;
  const svg = hit.ownerSVGElement, [x0, x1] = hit.dataset.intraHit.split(',').map(Number), box = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
  const x = (e.clientX - box.left) / box.width * vb.width, frac = Math.min(1, Math.max(0, (x - x0) / (x1 - x0)));
  const cross = svg.querySelector('.ia-cross'); if (cross) { cross.setAttribute('x1', x0 + frac * (x1 - x0)); cross.setAttribute('x2', x0 + frac * (x1 - x0)); cross.setAttribute('visibility', 'visible'); }
  const out = document.getElementById('ia-read'); if (out) out.innerHTML = readAt(K.live, frac);
});

/* ---------- 個股診斷：分點、大戶 ---------- */
export function detailExtrasShell(stock) {
  return `${stock ? rulesSection(stock) : ''}<div class="ix-detail"><section class="panel"><div class="panelhead"><h3>🏦 主力分點 · 近 5 日</h3><span class="fine">FinMind 券商分點</span></div><div class="contentpad" id="ix-brokers"><p><i class="spinner"></i>讀取券商分點…</p></div></section>
  <section class="panel"><div class="panelhead"><h3>🐋 大戶持股 · 每週</h3><span class="fine">股權分散表</span></div><div class="contentpad" id="ix-holders"><p><i class="spinner"></i>讀取股權分散表…</p></div></section>
  <section class="panel ix-wide"><div class="panelhead"><h3>🎫 認購權證</h3><span class="fine">FinMind 權證標的對照 · 證交所／櫃買權證行情</span></div><div class="contentpad" id="ix-warrants"><p><i class="spinner"></i>讀取權證資料…</p></div></section></div>`;
}
export async function fillDetailExtras(id, current) {
  const fill = async (sel, path, render) => { try { const d = await C.api(path); if (current() === id && document.querySelector(sel)) document.querySelector(sel).innerHTML = render(d); } catch (e) { if (current() === id && document.querySelector(sel)) document.querySelector(sel).innerHTML = `<p class="fine">${esc(e.message)}</p>`; } };
  await Promise.all([fill('#ix-brokers', 'brokers?id=' + id, brokerHTML), fill('#ix-holders', 'holders?id=' + id, holderHTML), fill('#ix-warrants', 'warrants?id=' + id, warrantHTML)]);
}

/* ---------- AI 盤後日報（今日焦點頁頂端） ---------- */
async function loadReport(date) { try { L.report = await C.api('report' + (date ? '?date=' + date : '')); } catch (e) { L.report = { error: e.message }; } L.reportLoaded = true; }
export function reportPanel() {
  if (!L.reportLoaded) { loadReport().then(() => C.page() === 'home' && C.redraw()); return ''; }
  const r = L.report; if (!r) return '';
  const today = MK.today();
  const body = r.busy ? '<div class="empty"><p><i class="spinner"></i>AI 正在撰寫今日盤後日報…</p></div>' : r.report ? reportHTML(r.report)
    : !r.configured ? `<div class="empty"><h3>AI 盤後日報</h3><p>設定推理模型後，平日 ${esc(r.settings?.time || '16:30')} 會自動彙整熱浪、法人、雷達與新聞寫成日報，並推播到手機。</p><button class="primary" data-page="settings">前往設定 →</button></div>`
      : `<div class="empty"><p>尚無日報。平日 ${esc(r.settings?.time || '16:30')} 後自動產生，也可以立即產生。</p></div>`;
  return `<section class="panel lv-report"><div class="panelhead"><div><h2><span class="idx">AI</span>盤後日報</h2><p>AI 依當日資料撰寫 · 研究紀錄，非投資建議</p></div><div class="actions">${r.dates?.length ? `<select data-rdate>${r.dates.slice().reverse().map(d => `<option ${d === r.report?.date ? 'selected' : ''}>${d}</option>`).join('')}</select>` : ''}${r.report && !r.busy ? '<button data-rcard title="下載 9:16 盤後籌碼整理圖卡（PNG）">📊 下載圖卡</button>' : ''}${r.configured && !r.busy ? `<button data-rgen>${r.report?.date === today ? '⟳ 重新產生' : '✨ 產生今日日報'}</button>` : ''}</div></div>${r.error && !r.busy ? `<div class="notice warn" style="margin:12px 18px 0"><span>${esc(r.error)}</span></div>` : ''}${body}</section>`;
}

/* ---------- 設定頁：日報排程（推理模型與金鑰在「推理模型」設定） ---------- */
export function claudeSettings() {
  const st = C.state(), rs = L.report?.settings || { auto: true, time: '16:30' };
  if (!L.reportLoaded) loadReport().then(() => C.page() === 'settings' && C.redraw());
  return `<section class="panel contentpad"><h2>AI 盤後日報排程 <span class="tag ${st.llmConfigured ? 'cyan' : 'amber'}">${st.llmConfigured ? 'LINKED' : 'OFFLINE'}</span></h2><p>${st.llmConfigured ? `使用 <b translate="no">${esc(st.llm?.model || '')}</b>（可在上方「推理模型」更換）。` : '請先在上方「推理模型」設定服務與金鑰。'}</p>
  <form id="report-form" style="margin-top:18px"><div class="formgrid"><label class="field">自動產生時間<input type="time" name="time" value="${esc(rs.time)}" required></label><label class="checkbox field" style="flex-direction:row;align-self:end"><input type="checkbox" name="auto" ${rs.auto ? 'checked' : ''}>平日自動產生並推播</label></div><p class="fine">只在當天有盤中監控紀錄時自動產生（休市日略過）。一份日報約使用數萬 input tokens，費用依所選服務的定價計算。</p><div class="form-actions"><button type="submit">儲存日報設定</button></div></form></section>`;
}

/* ---------- 設定頁：新聞推播 ---------- */
const hhmm = ms => MK.clock(ms);
function newsStatusHTML() {
  const n = L.monitor?.news, s = n?.status; if (!n) return '';
  if (!n.enabled) return '目前關閉';
  return `${s?.error ? `<span class="down">⚠ ${esc(s.error)}</span>${s.pausedUntil ? `（${hhmm(s.pausedUntil).slice(0, 5)} 後重試）` : ''}` : s?.at ? `上次掃描 <b class="mono">${hhmm(s.at)}</b>${s.seeded ? ' · 首次掃描，現有新聞只記錄不推播' : ` · 本次新增 <b class="mono">${s.found}</b> 則`}` : '即將開始第一次掃描…'} · 今日新聞 <b class="mono">${L.alerts.filter(a => a.type === 'news').length || s?.today || 0}</b> 則`;
}
export function newsSettings() {
  if (!L.monitor) { refreshMonitor().then(() => C.page() === 'settings' && C.redraw()); return ''; }
  const n = L.monitor.news || { enabled: false, scope: 'all', quiet: false };
  return `<section class="panel contentpad" id="news-settings"><h2>🗞️ 新聞推播 <span class="tag ${n.enabled ? 'cyan' : ''}">${n.enabled ? 'ON' : 'OFF'}</span></h2>
  <p>開啟後每分鐘掃描一次資料源的全市場新聞（以 FinMind 為例約 60 次請求／小時；當地時間 00:00–08:00 另查前一日，約 120 次／小時；FinMind 新聞約每 2 小時更新一批），台股另每分鐘查一次鉅亨網最新新聞（幾分鐘內就有）。研究族群的成分股一出現新新聞，就推播到手機、在電腦跳出通知，並列入盤中雷達的「新聞」分類。論壇貼文、個股概覽頁與同一則新聞在不同來源的重複轉載會自動略過。</p>
  <div class="news-set"><label class="checkbox"><input type="checkbox" data-npush="enabled" ${n.enabled ? 'checked' : ''}><b>開啟新聞推播</b></label>
  <label class="field">推播範圍<select data-npush="scope"><option value="all" ${n.scope === 'all' ? 'selected' : ''}>全部研究族群成分股</option><option value="watch" ${n.scope === 'watch' ? 'selected' : ''}>只推自選股</option></select></label>
  <label class="checkbox"><input type="checkbox" data-npush="quiet" ${n.quiet ? 'checked' : ''}>夜間勿擾（23:00–07:00 只記錄、不推播）</label></div>
  <p class="fine" id="news-status">${newsStatusHTML()}</p>
  <p class="fine">電腦提醒：${L.notify ? '桌面通知已開啟，新聞會以桌面通知顯示（點通知開啟原文）' : '桌面通知未開啟，新聞會在頁面內彈窗提醒；可到「盤中雷達」開啟桌面通知'}。手機需先在「盤中 → 雷達」開啟通知。第一次開啟時，當下已有的新聞只記錄、不推播。</p></section>`;
}
async function saveNews(patch) {
  const cur = L.monitor?.news || { enabled: false, scope: 'all', quiet: false }, next = { enabled: cur.enabled, scope: cur.scope, quiet: cur.quiet, ...patch };
  const r = await C.api('news/settings', next); L.monitor = { ...L.monitor, news: r.news };
  C.toast(next.enabled ? (patch.enabled ? '新聞推播已開啟，每分鐘掃描一次' : '新聞推播設定已儲存') : '新聞推播已關閉');
  if (next.enabled) loadAlerts(!L.date);
  if (C.page() === 'settings') C.redraw();
}

/* ---------- 事件 ---------- */
document.addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b || !C) return; const ds = b.dataset;
  try {
    if (ds.wbr) { // 個股權證：展開／收合單一權證的分點進出（第一次展開時查詢）
      const row = document.querySelector(`[data-wbr-row="${ds.wbr}"]`); if (!row) return;
      if (!row.hidden) { row.hidden = true; return; }
      row.hidden = false; const cell = row.firstElementChild;
      if (!cell.dataset.loaded) { cell.innerHTML = '<i class="spinner"></i>'; try { cell.innerHTML = warrantBrokersHTML(await C.api(`warrants/brokers?wid=${encodeURIComponent(ds.wbr)}&date=${encodeURIComponent(ds.date)}`)); cell.dataset.loaded = '1'; } catch (err) { cell.innerHTML = `<p class="muted">${esc(err.message)}</p>`; } }
      return;
    }
    if (ds.kbar) return openChart(ds.kbar, 'live');
    if (ds.chartLive) return openChart(ds.chartLive, 'live');
    if (ds.igroup) { K.group = ds.igroup; return refreshChart(); }
    if (ds.cperiod) return openChart(K.id, ds.cperiod);
    if (ds.bgroup) { L.bgroup = ds.bgroup; savePref('nexus.boardGroup', ds.bgroup); if (L.board) L.board = { ...L.board, group: ds.bgroup, stocks: [], loading: true }; repaint(); await loadBoard(); return repaint(); }
    if (ds.bsort) { L.bsort = ds.bsort; savePref('nexus.boardSort', ds.bsort); return repaint(); }
    if (ds.agroup) { L.group = ds.agroup; return repaint(); }
    if (ds.alertStock) return openChart(ds.alertStock, 'live');
    if ('openReport' in ds) return C.setPage('home');
    if (ds.openChips) return C.setPage('chips');
    if (ds.paDel) { if (!confirm(t('刪除這則提醒？'))) return; L.rules = await C.api('price-alerts/delete', { id: ds.paDel }); paintRules(); return C.toast('已刪除提醒'); }
    if (ds.paToggle) { L.rules = await C.api('price-alerts', { id: ds.paToggle, active: ds.on === '1' }); paintRules(); return C.toast(ds.on === '1' ? '提醒已重新啟用' : '提醒已停用'); }
    if (ds.live === 'pip') return await openPip();
    if (ds.live === 'notify') {
      if (L.notify) { L.notify = false; try { localStorage.setItem('nexus.notify', '0'); } catch { } return C.page() === 'live' ? repaint() : C.redraw(); }
      if (!('Notification' in window)) throw new Error('此瀏覽器不支援桌面通知');
      if (await Notification.requestPermission() !== 'granted') throw new Error('瀏覽器未允許通知');
      L.notify = true; try { localStorage.setItem('nexus.notify', '1'); } catch { } Note('🔔 衡析桌面通知已開啟', { body: '盤中雷達異動與 AI 日報會在這裡提醒。', icon: '/favicon.svg' }); return C.page() === 'live' ? repaint() : C.redraw();
    }
    if (ds.rscope && L.draft) { L.draft.radar.scope = ds.rscope; return repaint(); }
    if ('rsave' in ds && L.draft) { await C.api('monitor/settings', L.draft); await loadMonitor(); C.toast('雷達設定已儲存，手機版同步套用'); return repaint(); }
    if ('rcard' in ds && L.report?.report) { b.disabled = true; const old = b.textContent; b.textContent = '繪製中…'; try { const [{ downloadReportCard }, data] = await Promise.all([import('./report-card.js'), C.api('report/card?date=' + L.report.report.date)]); if (await downloadReportCard(data) === 'download') C.toast('已下載盤後籌碼圖卡'); } finally { b.disabled = false; b.textContent = old; } return; }
    if ('rgen' in ds) { if (!confirm(t('使用推理模型產生今日盤後日報？可能產生少量 API 費用。'))) return; await C.api('report/generate', {}); await loadReport(); C.toast('AI 開始撰寫日報'); return C.redraw(); }
  } catch (err) { C.toast(err.message); }
});
document.addEventListener('change', async e => {
  const t = e.target; if (!C) return;
  if (t.dataset.npush) { t.disabled = true; try { await saveNews({ [t.dataset.npush]: t.type === 'checkbox' ? t.checked : t.value }); } catch (err) { C.toast(err.message); C.redraw(); } finally { t.disabled = false; } return; }
  if (t.dataset.rset && L.draft) { const p = t.dataset.rset, v = t.type === 'checkbox' ? t.checked : Number(t.value); if (p === 'monitor') L.draft.monitor = v; else { const ks = p.split('.'); ks.slice(0, -1).reduce((o, k) => o[k], L.draft.radar)[ks.at(-1)] = v; } }
  if ('rdate' in t.dataset) { await loadReport(t.value); C.redraw(); }
});
document.addEventListener('submit', async e => {
  const f = e.target; if (!C) return;
  if ('paForm' in f.dataset) {
    e.preventDefault(); const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
    try { L.rules = await C.api('price-alerts', priceRuleBody(f)); f.elements.value.value = ''; f.elements.note.value = ''; if (f.elements.stockId.type !== 'hidden') f.elements.stockId.value = ''; paintRules(); C.toast('已新增提醒，盤中條件成立時通知'); }
    catch (err) { C.toast(err.message); } finally { btn.disabled = false; } return;
  }
  if (f.id !== 'report-form') return; e.preventDefault();
  const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
  try {
    await C.api('report/settings', { auto: f.elements.auto.checked, time: f.elements.time.value }); await loadReport(); C.toast('日報設定已儲存');
  } catch (err) { C.toast(err.message); } finally { btn.disabled = false; }
});
