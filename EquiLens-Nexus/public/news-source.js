const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names={finmind:'FinMind',cnyes:'鉅亨網'},statuses={disabled:'未啟用',paused:'暫停重試',error:'讀取失敗',ok:'讀取正常',waiting:'尚未掃描'};
export function newsSourcesHTML(news,{time=ms=>new Date(ms).toISOString(),t=s=>s}={}) {
 return (news?.status?.sources||[]).map(s=>`<span data-news-source="${esc(s.provider)}" style="display:block;margin-top:8px"><b translate="no">${esc(names[s.provider]||s.provider)}</b> · ${esc(t(statuses[s.status]||statuses.waiting))}<br>${esc(t('最後成功'))}：${esc(s.lastSuccess?time(s.lastSuccess):'—')} · ${esc(t('最後新文'))}：${esc(s.lastNew?time(s.lastNew):'—')}<br>${esc(t('錯誤'))}：${esc(s.error||'—')} · ${esc(t('重試時間'))}：${esc(s.retryAt?time(s.retryAt):'—')}</span>`).join('');
}
