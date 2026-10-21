// 盤中即時推播（WebSocket）：連線、認證、分頻道分批訂閱、心跳檢查、斷線重連；收到的資料每隔一小段時間批次交給呼叫端。
// 資料源只需提供 stream 規格：{ url, auth(key), subscribe(symbols, channel), batch, parse(msg, market) → 事件或 null }。
// 事件有 key 的（例如五檔、分 K、聚合行情）同一批只保留最新一筆；沒有 key 的（逐筆成交）全部依序保留。
// 只在盤中由伺服器開啟，收盤後關閉；金鑰只用於連線後的認證訊息，不出現在網址或紀錄中。

const QUIET_MS = 75000;      // 這麼久沒有任何訊息（伺服器每 30 秒送心跳）就重新連線
const AUTH_RETRY_MS = 10 * 60e3; // 認證失敗（金鑰無效）時 10 分鐘後才再試
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// extra：額外訂閱（例如五檔錄製器加錄的股票，只訂閱五檔）。只有額外訂閱變更時在原連線上增減訂閱、不重新連線
// （訂閱回覆帶有訂閱 id，取消時用它）；額外訂閱另計數量，不影響主清單是否訂閱完整的判斷。
// onEvent：每個解析後的事件（批次合併前，五檔不會被同一批較新的一筆蓋掉），供錄製使用
export function createStream({ spec, key, market, symbols = [], channels = ['aggregates'], extra = null, onEvents, onEvent = null, onStatus = () => { }, connect = url => new WebSocket(url), now = Date.now, timers = { setTimeout, clearTimeout, setInterval, clearInterval }, flushMs = 1000 }) {
  let ws = null, closed = false, want = [...new Set(symbols)], chans = [...channels], backoff = 5000, retryTimer = null, lastMsg = 0, subscribed = 0, authed = false, everAuthed = false;
  let ex = normExtra(extra), subIds = new Map(), extraSubscribed = 0, pendingUnsub = new Map(); // pendingUnsub：已送出取消、等待回覆的訂閱 id → 「頻道:代號」 // subIds：額外訂閱「頻道:代號」→ 訂閱 id
  let list = [], keyed = new Map();
  const exKey = (ch, s) => ch + ':' + s, exSet = () => new Set(ex.channels.flatMap(ch => ex.symbols.map(s => exKey(ch, s))));
  let exKeys = exSet();
  const status = s => onStatus({ ...s, symbols: want.length, channels: chans, expected: want.length * chans.length, subscribed, extraSymbols: ex.symbols.length, extraExpected: ex.symbols.length * ex.channels.length, extraSubscribed });
  const subscribe = (sock, symbols, chs) => { const n = spec.batch || 50; for (const ch of chs) for (let i = 0; i < symbols.length; i += n) sock.send(JSON.stringify(spec.subscribe(symbols.slice(i, i + n), ch))); };
  const flushTimer = timers.setInterval(() => {
    if (list.length || keyed.size) { const events = [...list, ...keyed.values()]; list = []; keyed = new Map(); try { onEvents(events); } catch { } }
    if (ws && authed) { if (now() - lastMsg > QUIET_MS) { status({ connected: false, error: 'no-heartbeat' }); reopen(0); } else status({ connected: true, alive: lastMsg }); }
  }, flushMs);
  flushTimer?.unref?.();

  function open() {
    if (closed || !want.length) return;
    authed = false; subscribed = 0; extraSubscribed = 0; subIds = new Map(); pendingUnsub = new Map(); lastMsg = now();
    let sock;
    try { sock = connect(spec.url); } catch (e) { status({ connected: false, error: e.message }); return reopen(); }
    ws = sock;
    sock.addEventListener('open', () => { if (ws === sock) sock.send(JSON.stringify(spec.auth(key))); });
    sock.addEventListener('message', ev => {
      if (ws !== sock) return;
      lastMsg = now();
      let msg; try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch { return; }
      if (msg.event === 'authenticated') {
        authed = true; backoff = 5000;
        subscribe(sock, want, chans);
        const extraOnly = ex.symbols.filter(s => !want.includes(s)); // 主清單已有的頻道不重複訂閱
        for (const ch of ex.channels) subscribe(sock, chans.includes(ch) ? extraOnly : ex.symbols, [ch]);
        const resumed = everAuthed ? now() : 0; everAuthed = true;
        return status({ connected: true, error: '', authFailed: false, since: now(), ...(resumed ? { resumed } : {}) });
      }
      if (msg.event === 'subscribed') {
        for (const d of Array.isArray(msg.data) ? msg.data : [msg.data || {}]) {
          const k = d?.channel && d?.symbol ? exKey(d.channel, d.symbol) : '';
          if (k && exKeys.has(k) && !(chans.includes(d.channel) && want.includes(d.symbol))) { if (!subIds.has(k)) extraSubscribed++; subIds.set(k, d.id ?? null); }
          else subscribed++;
        }
        return status({ connected: true });
      }
      // 取消訂閱的回覆：只扣掉自己送出取消的那些 id（富果的回覆可能列出不只被取消的訂閱，若逐項扣減會把仍在推播的訂閱算成不足）
      if (msg.event === 'unsubscribed') {
        for (const d of Array.isArray(msg.data) ? msg.data : [msg.data || {}]) {
          const k = d?.id != null ? pendingUnsub.get(d.id) : null; if (!k) continue;
          pendingUnsub.delete(d.id); if (subIds.delete(k)) extraSubscribed = Math.max(0, extraSubscribed - 1);
        }
        return status({ connected: true });
      }
      if (msg.event === 'error') {
        const text = String(msg.data?.message || msg.message || 'error');
        if (!authed) { status({ connected: false, error: text, authFailed: true }); return reopen(AUTH_RETRY_MS); }
        return status({ connected: true, error: text });
      }
      const e = spec.parse(msg, market);
      if (e) { if (onEvent) try { onEvent(e); } catch { } if (e.key) keyed.set(e.key, e); else list.push(e); }
    });
    const lost = () => { if (ws === sock) { ws = null; status({ connected: false }); reopen(); } };
    sock.addEventListener('close', lost);
    // 連線建立前失敗時（例如對方尚未啟動），Node 的 WebSocket 可能只發出 error、不發 close：同樣安排重連；之後若再收到 close 不會重複
    sock.addEventListener('error', lost);
  }
  function drop() { if (ws) { const s = ws; ws = null; try { s.close(); } catch { } } }
  function reopen(delay = backoff) {
    if (closed) return;
    drop();
    timers.clearTimeout(retryTimer);
    retryTimer = timers.setTimeout(open, delay);
    retryTimer?.unref?.();
    if (delay === backoff) backoff = Math.min(60000, backoff * 2);
  }
  open();
  return {
    // 訂閱清單或頻道變更（例如自選股增減、方案改變）：重新連線並以新清單訂閱
    update(next, nextChannels = chans, nextExtra = ex) {
      const l = [...new Set(next)], x = normExtra(nextExtra);
      if (!same(l, want) || !same(nextChannels, chans)) {
        want = l; chans = [...nextChannels]; ex = x; exKeys = exSet();
        if (!want.length) { drop(); return status({ connected: false }); }
        return reopen(0);
      }
      if (same(x.symbols, ex.symbols) && same(x.channels, ex.channels)) return;
      const before = exKeys; ex = x; exKeys = exSet();
      if (!ws || !authed) return; // 尚未連上：連上後依新清單訂閱
      // 只增減額外訂閱：取消已不需要的（用訂閱 id；還沒收到回覆的沒有 id，下次重連自然不再訂閱），訂閱新增的
      const gone = [...before].filter(k => !exKeys.has(k) && subIds.get(k) != null), ids = gone.map(k => subIds.get(k));
      for (const k of gone) pendingUnsub.set(subIds.get(k), k);
      if (ids.length && spec.unsubscribe) for (let i = 0; i < ids.length; i += 100) ws.send(JSON.stringify(spec.unsubscribe(ids.slice(i, i + 100))));
      const add = new Map();
      for (const k of exKeys) if (!before.has(k)) { const [ch, s] = k.split(':'); if (chans.includes(ch) && want.includes(s)) continue; if (!add.has(ch)) add.set(ch, []); add.get(ch).push(s); }
      for (const [ch, syms] of add) subscribe(ws, syms, [ch]);
      status({ connected: true });
    },
    close() { closed = true; timers.clearInterval(flushTimer); timers.clearTimeout(retryTimer); drop(); },
    get symbols() { return want; },
    get channels() { return chans; },
    get extra() { return ex; },
  };
}
function normExtra(x) { return { symbols: [...new Set(x?.symbols || [])].sort(), channels: [...(x?.channels || ['books'])] }; }

// 多條連線：把股票分組（例如依代號排序平均分成兩組），每組一條連線；狀態合併後回報
export function createStreamPool({ groups, onStatus = () => { }, ...common }) {
  let streams = [], states = [];
  const report = () => {
    const live = states.slice(0, streams.length);
    onStatus({
      connected: live.length > 0 && live.every(s => s.connected), connections: live.map(s => ({ connected: !!s.connected, symbols: s.symbols || 0, subscribed: s.subscribed || 0, expected: s.expected || 0, error: s.error || '' })),
      symbols: live.reduce((a, s) => a + (s.symbols || 0), 0), subscribed: live.reduce((a, s) => a + (s.subscribed || 0), 0), expected: live.reduce((a, s) => a + (s.expected || 0), 0),
      extraSymbols: live.reduce((a, s) => a + (s.extraSymbols || 0), 0), extraSubscribed: live.reduce((a, s) => a + (s.extraSubscribed || 0), 0), extraExpected: live.reduce((a, s) => a + (s.extraExpected || 0), 0),
      channels: live[0]?.channels || [], alive: live.length ? Math.min(...live.map(s => s.alive || 0)) : 0, error: live.map(s => s.error).find(Boolean) || '', authFailed: live.some(s => s.authFailed),
      resumed: Math.max(0, ...live.map(s => s.resumed || 0)), since: Math.max(0, ...live.map(s => s.since || 0)),
    });
  };
  const make = (g, i) => createStream({ ...common, symbols: g.symbols, channels: g.channels, extra: g.extra, onStatus: s => { states[i] = { ...states[i], ...s }; report(); } });
  function set(next) {
    while (streams.length > next.length) { streams.pop().close(); states.pop(); }
    next.forEach((g, i) => { if (streams[i]) streams[i].update(g.symbols, g.channels, g.extra); else { states[i] = {}; streams[i] = make(g, i); } });
    report();
  }
  set(groups);
  return { update: set, close() { for (const s of streams) s.close(); streams = []; }, get size() { return streams.length; } };
}
// 訂閱規劃（純函式）：依資料源的推播規格與方案，決定模式、頻道、股票、連線分組與五檔錄製器加錄。
// fullAllowed：當沖監控已啟用、引擎就緒且今天沒有退回精簡模式；bookSlots(剩餘訂閱數)／bookExtras(主清單, 數量) 由伺服器提供。
// 資料源的 channels.book 為空陣列時（例如 Shioaji 轉接服務）不加錄。
export function planStream({ spec, planId, universe, watchlistSize, fullAllowed, bookSlots, bookExtras }) {
  const plan = spec.plans?.[planId] || { limit: 300, connections: 1, perMinute: 600 };
  const full = !!fullAllowed && !!spec.channels?.full && watchlistSize * spec.channels.full.length <= plan.limit;
  const channels = full ? spec.channels.full : (spec.channels?.lite || ['aggregates']), ids = universe.slice(0, Math.floor(plan.limit / channels.length));
  const groups = full && plan.connections > 1 && ids.length > 1 ? splitSymbols(ids, plan.connections) : [ids];
  // 五檔錄製器加錄：用剩下的訂閱數（保留 50 個餘裕），依代號固定分到各連線
  const book = spec.channels?.book || ['books'];
  const slots = book.length ? bookSlots(plan.limit - ids.length * channels.length) : 0, extra = slots > 0 ? bookExtras(new Set(ids), slots) : [];
  const ex = spreadSymbols(extra, groups.length);
  return { planId, plan, full, channels, ids, total: universe.length, slots, extra, groups: groups.map((symbols, i) => ({ symbols, channels, extra: { symbols: ex[i] || [], channels: book } })) };
}
// 依代號排序後平均分成 n 組（固定分組，重啟後訂閱不變）
export function splitSymbols(symbols, n) {
  const list = [...new Set(symbols)].sort(), size = Math.ceil(list.length / Math.max(1, n)), out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out.length ? out : [[]];
}
// 依代號雜湊固定分到 n 組：清單增減時其餘股票不換連線（額外訂閱用，盤中增減不必重新訂閱）
export function spreadSymbols(symbols, n) {
  const out = Array.from({ length: Math.max(1, n) }, () => []);
  for (const s of [...new Set(symbols)].sort()) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; out[h % out.length].push(s); }
  return out;
}
