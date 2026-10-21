import {t} from './i18n.js';
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = v => v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-US',{maximumFractionDigits:4});
const color = kind => ({emerging:'#ffbd69',predecessor:'#bb9aff',listed:'#52d6da'}[kind] || '#94a3b8');
function links(sources) {
  return [...new Set(sources || [])].filter(u=>{try{return ['https:','http:'].includes(new URL(u).protocol);}catch{return false;}}).map((u,i)=>`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(t('來源 {n}',{n:i+1}))}</a>`).join(' · ');
}
function chart(h) {
  const p=h.points.filter(r=>Number.isFinite(r.close)&&r.close>0&&Number.isFinite(r.high)&&Number.isFinite(r.low));
  if (!p.length) return `<p>${esc(t('此區間沒有有效成交行情；請查看缺日說明。'))}</p>`;
  const days=h.calendar, index=new Map(days.map((d,i)=>[d,i])), W=900,H=270,left=60,right=18,top=20,bottom=35;
  const lo=Math.min(...p.map(r=>r.low)),hi=Math.max(...p.map(r=>r.high)),range=hi-lo||1;
  const x=d=>left+((index.get(d) ?? 0)+.5)/Math.max(days.length,1)*(W-left-right),y=v=>top+(hi-v)/range*(H-top-bottom),tick=Math.max(1,Math.min(5,(W-left-right)/Math.max(days.length,1)*.35));
  let svg='';
  for(let i=0;i<5;i++){const v=lo+range*i/4;svg+=`<line x1="${left}" x2="${W-right}" y1="${y(v)}" y2="${y(v)}" stroke="currentColor" opacity=".12"/><text x="${left-7}" y="${y(v)+4}" text-anchor="end" fill="currentColor" font-size="11">${fmt(Number(v.toFixed(2)))}</text>`;}
  for(const g of h.gaps) if(index.has(g.date)) svg+=`<line data-gap-date="${esc(g.date)}" x1="${x(g.date)}" x2="${x(g.date)}" y1="${H-bottom-8}" y2="${H-bottom}" stroke="#ffbd69" opacity=".65"><title>${esc(g.date)} · ${esc(t(g.reason))}</title></line>`;
  let previous=null;
  for(const r of p){
    if(!index.has(r.date))continue;
    if(previous && (previous.kind!==r.kind||previous.originalId!==r.originalId))svg+=`<line x1="${x(r.date)-tick}" x2="${x(r.date)-tick}" y1="${top}" y2="${H-bottom}" stroke="${color(r.kind)}" opacity=".5" stroke-dasharray="3 4"/>`;
    svg+=`<g data-history-kind="${esc(r.kind)}" data-original-id="${esc(r.originalId)}"><title>${esc(r.date)} · ${esc(t(r.market))} · ${esc(t('原代號'))} ${esc(r.originalId)} · ${esc(t('最高'))} ${fmt(r.high)} · ${esc(t('最低'))} ${fmt(r.low)} · ${esc(t('收盤／最後成交價'))} ${fmt(r.close)}</title><line x1="${x(r.date)}" x2="${x(r.date)}" y1="${y(r.high)}" y2="${y(r.low)}" stroke="${color(r.kind)}"/><line x1="${x(r.date)}" x2="${x(r.date)+tick}" y1="${y(r.close)}" y2="${y(r.close)}" stroke="${color(r.kind)}" stroke-width="2"/></g>`;previous=r;
  }
  svg+=`<text x="${left}" y="${H-8}" fill="currentColor" font-size="12">${esc(h.from)}</text><text x="${W-right}" y="${H-8}" text-anchor="end" fill="currentColor" font-size="12">${esc(h.to)}</text>`;
  return `<svg class="history-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('分市場歷史高低價與最後成交價'))}">${svg}</svg>`;
}
export function renderHistory(h) {
  if(!h)return '';
  if(h.error)return `<section class="history-panel"><h3>${esc(t('歷史行情與缺日說明'))}</h3><p role="status">${esc(t(h.error))}</p></section>`;
  const groups=new Map(),reasons=new Map();
  for(const r of h.points){const key=r.kind+'|'+r.originalId;if(!groups.has(key))groups.set(key,{...r,n:0});groups.get(key).n++;}
  for(const g of h.gaps){const key=g.kind+'|'+g.reason;if(!reasons.has(key))reasons.set(key,{kind:g.kind,reason:g.reason,dates:[],sources:[]});reasons.get(key).dates.push(g.date);reasons.get(key).sources.push(...(g.sources||[]));}
  return `<section class="history-panel"><div class="history-heading"><h3>${esc(t('歷史行情與缺日說明'))}</h3><small>${esc(h.from)} — ${esc(h.to)}</small></div>
    <p class="history-help">${esc(t('直線為每日高低價，右側短線為收盤或最後成交價；不同市場與原代號分色顯示。'))}</p>
    <div class="history-legend">${[...groups.values()].map(g=>`<span style="border-color:${color(g.kind)}">${esc(t(g.market))} · ${esc(t('原代號'))} ${esc(g.originalId)} · ${esc(t('{n} 日',{n:g.n}))}${g.kind==='predecessor'?` · ${esc(t('股份轉換前'))}`:''}</span>`).join('')}</div>
    <div class="history-plot" tabindex="0" role="region" aria-label="${esc(t('歷史行情圖表'))}">${chart(h)}</div><p class="history-mobile-hint">${esc(t('圖表可左右滑動；精確數值請展開逐日行情。'))}</p>
    <p class="history-help">${esc(t(h.points.some(r=>r.kind==='emerging') ? '興櫃沒有開盤價；前日均價另列，不作為 K 線開盤價。補充行情不參與評分及均線計算。' : '補充行情不參與評分及均線計算。'))}</p>
    ${(h.notes||[]).length?`<ul class="history-notes">${h.notes.map(n=>`<li>${esc(t(n))}</li>`).join('')}</ul>`:''}
    <details class="history-data"><summary>${esc(t('查看逐日行情與來源'))} · ${h.points.length}</summary><div class="history-scroll" tabindex="0" role="region" aria-label="${esc(t('歷史行情明細'))}"><table><thead><tr>${['日期','市場','原代號','開盤價','前日均價（興櫃）','最高','最低','收盤／最後成交價','當日均價（興櫃）','成交股數','來源'].map(x=>`<th>${esc(t(x))}</th>`).join('')}</tr></thead><tbody>${h.points.map(r=>`<tr data-original-id="${esc(r.originalId)}"><td>${esc(r.date)}</td><td>${esc(t(r.market))}</td><td>${esc(r.originalId)}</td><td>${r.kind==='emerging'?esc(t('不適用')):fmt(r.open)}</td><td data-previous-average="${esc(r.previousAverage ?? '')}">${fmt(r.previousAverage)}</td><td>${fmt(r.high)}</td><td>${fmt(r.low)}</td><td>${fmt(r.close)}</td><td>${fmt(r.dailyAverage)}</td><td>${fmt(r.volume)}</td><td>${links(r.sources)||'—'}</td></tr>`).join('')}</tbody></table></div></details>
    <div class="history-gaps"><h4>${esc(t('缺日原因'))} · ${h.gaps.length}</h4>${reasons.size?[...reasons.values()].map(g=>`<details><summary>${esc(t(g.kind))} · ${esc(t('{n} 日',{n:g.dates.length}))}</summary><p>${esc(t(g.reason))}</p><p class="history-dates">${g.dates.map(d=>`<span data-gap-date="${esc(d)}">${esc(d)}</span>`).join(' ')}</p><p>${links(g.sources)}</p></details>`).join(''):`<p>${esc(t('這個區間沒有尚待說明的缺日。'))}</p>`}</div>
    <small class="history-help">${esc(t('原因查核日期'))}：${esc(String(h.checkedAt||'—').slice(0,10))} · ${esc(t('原始價格，未作除權息還原。'))}</small></section>`;
}
