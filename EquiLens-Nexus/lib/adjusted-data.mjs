// Provenance is attached only by an adapter that actually requested adjusted data.
// Legacy arrays, including raw-as-adjusted, remain on disk but are not trusted.
export function trustedAdjusted(raw={}) {
  const p=raw.adjustedProvenance;
  return !raw.adjustedIsRaw && p?.kind==='adjusted' &&
    ((p.provider==='finmind'&&p.dataset==='TaiwanStockPriceAdj') || (p.provider==='fugle'&&p.dataset==='historical/candles?adjusted=true')) &&
    /^\d{4}-\d{2}-\d{2}$/.test(p.from||'') && /^\d{4}-\d{2}-\d{2}$/.test(p.to||'') && Number.isFinite(Date.parse(p.fetchedAt)) &&
    Array.isArray(raw.adjusted) && raw.adjusted.length>0 && raw.adjusted.every(r=>r.date>=p.from&&r.date<=p.to);
}
export const adjustedRows=raw=>trustedAdjusted(raw)?raw.adjusted:[];
