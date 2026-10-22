// Shared desktop/mobile source labels and fail-closed board presentation.
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const quoteProviderName = id => ({shioaji:'Shioaji 行情轉接',fugle:'富果',finmind:'FinMind',twse:'TWSE／TPEx'}[id] || id || '未指定來源');
export const boardUnavailableLabel = status => ({'not-subscribed':'未列入目前訂閱',disconnected:'Shioaji 已斷線',stale:'推播連線逾時',paused:'盤中監控已關閉',closed:'非盤中時段',error:'無法取得看板狀態'}[status] || '等待本次連線的新報價');
export function boardFeedNotice(feed) {
  if (!feed) return '';
  const label = {live:'推播連線正常',partial:'訂閱未完整或來源回報異常',waiting:'等待本次連線的新報價',disconnected:'已斷線，等待重新連線',stale:'連線逾時，資料停止更新',paused:'盤中監控已關閉',closed:'非盤中時段',error:'無法取得看板狀態'}[feed.status] || '等待報價';
  return `<div class="notice ${feed.status==='live'?'':'warn'}" data-board-feed role="status"><span>${esc(quoteProviderName(feed.provider))} · 研究範圍（非全市場） · 訂閱 ${esc(feed.subscribed)} / ${esc(feed.planned)} · 有效報價 ${esc(feed.quoted)} 檔 · ${esc(label)} · 最後報價時間 ${esc(feed.asOf || '—')}（台北）</span></div>`;
}
export function snapshotErrorNotice(monitor) {
  const snapshot = monitor?.snapshot || {error:monitor?.error};
  if (!snapshot.error) return '';
  return `<div class="notice warn" data-snapshot-error role="status"><span>快照來源 ${esc(quoteProviderName(snapshot.provider))} · ${esc(snapshot.error)} · 即時推播狀態另列。</span></div>`;
}
function clearBoard(board,status) {
  return {...board,live:false,stream:false,asOf:null,feed:{...board.feed,status,quoted:0},stocks:board.stocks.map(s=>({...s,quote:null,spark:[],sparkX:[],status:s.status==='not-subscribed'?s.status:status}))};
}
export function boardRequestFailed(board) { return board?.provider==='shioaji'?clearBoard(board,'error'):board; }
export function currentBoardResponse(board,today) {
  if(board?.provider!=='shioaji'||board.date===today)return board;
  const result=clearBoard(board,'waiting');result.date=today;result.feed.asOf=null;return result;
}

// Coalesce same-group polling, but let a new group replace the active intent.
// A timeout clears live presentation even if the underlying fetch never settles.
export function createBoardLoader({ group, request, receive, fail, today, timeoutMs = 10000 }) {
  let sequence = 0, pending = null;
  return function load() {
    const wanted = group();
    if (pending?.group === wanted) return pending.promise;
    const entry = { group: wanted, sequence: ++sequence }; pending = entry;
    entry.promise = (async () => {
      let timer;
      try {
        const response = await Promise.race([request(wanted),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('看板連線逾時，等待恢復')),timeoutMs);})]);
        if (entry.sequence === sequence && wanted === group()) receive(currentBoardResponse(response,today()));
      } catch (e) {
        if (entry.sequence === sequence && wanted === group()) fail(e);
      } finally { clearTimeout(timer); if (pending === entry) pending = null; }
    })();
    return entry.promise;
  };
}
