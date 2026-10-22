// 桌面與手機共用：推播連線狀態和研究範圍。報價時間不以頁面刷新時間替代。
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function heatFeedNotice(feed) {
  if (!feed) return '';
  const labels = { 'display-paused': '畫面更新已暫停', partial: '訂閱未完整或來源回報異常', live: '推播連線正常', waiting: '等待今日有效報價', disconnected: '已斷線，等待重新連線', stale: '連線逾時，資料已停止更新', paused: '盤中監控已關閉', closed: '非盤中時段', error: '無法取得連線狀態' };
  return `<div class="notice ${feed.status === 'live' ? '' : 'warn'}" role="status"><span>Shioaji · 研究範圍（非全市場） · 已確認訂閱 ${esc(feed.subscribed ?? '—')} / ${esc(feed.symbols ?? '—')} 檔 · 有效普通股報價 ${esc(feed.quoted ?? 0)} 檔 · ${esc(labels[feed.status] || labels.error)} · 最後報價時間 ${esc(feed.asOf || '—')}（台北）</span></div>`;
}

// A request started before midnight can complete on the next trading date.
export function currentHeatResponse(response, today) {
  if ((response.feed?.source === 'shioaji' || response.data?.source === 'shioaji') && response.data?.date !== today && response.data) {
    return { ...response, data: null, feed: { ...response.feed, status: 'waiting', quoted: 0, asOf: null } };
  }
  return response;
}
