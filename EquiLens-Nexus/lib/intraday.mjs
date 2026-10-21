// 看板個股即時走勢：每分鐘價量、個股當日均價線（VWAP）、所屬族群均價線。
// 族群均價線＝各成分股「當下累計 VWAP 相對參考價的漲跌幅」以累計成交金額加權平均（量能加權），再換算到本股的價位：
//   本股參考價 ×（1＋族群加權均價漲跌幅）。本股價格在這條線之上，代表比族群的平均持有成本強。
// 序列格式：{ m:[分鐘], c:[收盤], v:[該分鐘量], cv:[累計量], ca:[累計成交值（價 × 張）] }，分鐘為當地時間的「一天第幾分鐘」。

// 當沖引擎的 1 分 K（逐筆累加，斷線補資料的分 K 沒有成交值時以 (高＋低＋收)/3 估算）
export function seriesFromBars(bars, p) {
  const list = [...(bars?.values?.() || [])].filter(b => b.c > 0 && b.m >= p.open && b.m <= p.close + 5).sort((a, b) => a.m - b.m);
  const out = { m: [], c: [], v: [], cv: [], ca: [] }; let cv = 0, ca = 0;
  for (const b of list) {
    const v = Math.max(b.tv || 0, b.cv || 0), typical = (Number.isFinite(b.h) && Number.isFinite(b.l) ? (b.h + b.l + b.c) / 3 : b.c);
    const amt = b.amt > 0 && b.tv >= v * 0.9 ? b.amt * (v / b.tv) : typical * v;
    cv += v; ca += amt;
    out.m.push(b.m); out.c.push(b.c); out.v.push(v); out.cv.push(cv); out.ca.push(ca);
  }
  return out;
}
// 時光機每分鐘畫格（收盤價、累計成交金額、累計量）：沒有即時推播資料時使用
export function seriesFromReplay(day, id, p) {
  const i = day?.ids?.indexOf(id) ?? -1, out = { m: [], c: [], v: [], cv: [], ca: [] }; if (i < 0) return out;
  const ps = day.ps || 100, as = day.as || 1e6, lot = p.lot || 1000; let pv = 0;
  for (const f of day.frames || []) {
    const c = f.p?.[i] / ps, cv = f.v?.[i], ca = f.a?.[i] * as / lot; if (!(c > 0) || !(cv > 0) || !(ca > 0)) continue;
    const [h, mm] = String(f.t).split(':').map(Number), m = h * 60 + mm; if (out.m.length && m <= out.m.at(-1)) continue;
    out.m.push(m); out.c.push(c); out.v.push(Math.max(0, cv - pv)); out.cv.push(cv); out.ca.push(ca); pv = cv;
  }
  return out;
}
export const replayRef = (day, id, p) => { const i = day?.ids?.indexOf(id) ?? -1; return i >= 0 && day.prev?.[i] > 0 ? day.prev[i] / (day.ps || 100) : null; };
// 個股累計 VWAP（每分鐘）
export const vwapLine = s => s.m.map((_, k) => s.cv[k] > 0 ? s.ca[k] / s.cv[k] : null);
// 族群均價線（換算到本股價位）：members＝[{ ref, s }]；同一分鐘至少 2 檔成分股有成交才畫
export function groupLine(minutes, members, ref) {
  const ms = members.filter(x => x.ref > 0 && x.s?.m?.length), ptr = ms.map(() => -1);
  return minutes.map(m => {
    let w = 0, sum = 0, n = 0;
    ms.forEach((x, j) => {
      while (ptr[j] + 1 < x.s.m.length && x.s.m[ptr[j] + 1] <= m) ptr[j]++;
      const k = ptr[j]; if (k < 0) return;
      const ca = x.s.ca[k], cv = x.s.cv[k]; if (!(ca > 0) || !(cv > 0)) return;
      const chg = ca / cv / x.ref - 1, amt = ca; w += amt; sum += chg * amt; n++;
    });
    return n >= 2 && w > 0 && ref > 0 ? Math.round(ref * (1 + sum / w) * 1e4) / 1e4 : null;
  });
}
// 富果盤中 1 分 K（REST）：{ date, open, high, low, close, volume, average? }；average 為累計均價時直接用來算累計成交值
export function seriesFromCandles(candles, p) {
  const out = { m: [], c: [], v: [], cv: [], ca: [] }; let cv = 0, ca = 0;
  for (const k of candles || []) {
    const hm = /T(\d{2}):(\d{2})/.exec(String(k.date)); if (!hm || !(k.close > 0)) continue;
    const m = +hm[1] * 60 + +hm[2]; if (m < p.open || m > p.close + 5 || (out.m.length && m <= out.m.at(-1))) continue;
    const v = Math.max(0, Number(k.volume) || 0); cv += v; ca = k.average > 0 ? k.average * cv : ca + (k.high + k.low + k.close) / 3 * v;
    out.m.push(m); out.c.push(k.close); out.v.push(v); out.cv.push(cv); out.ca.push(ca);
  }
  return out;
}

// 推播與快照中時間（date 欄位 'YYYY-MM-DD HH:MM:SS'）較新的一筆；時間相同時用推播；只有一邊時用那一邊
export function newerRow(streamRow, snapRow) {
  if (!streamRow) return snapRow || null;
  return !snapRow || String(streamRow.date) >= String(snapRow.date) ? streamRow : snapRow;
}

// 推播每分鐘最後成交價（Map 'HH:MM' → 價格）→ 看板走勢圖的點 [[盤中位置 0–1, 價格], …]；位置為 null（盤外）或價格不大於 0 的略過
export function sparkFromMinutes(minutes, posOf) {
  const out = [];
  for (const [t, price] of minutes || []) { const x = posOf(t); if (x != null && price > 0) out.push([x, price]); }
  return out.sort((a, b) => a[0] - b[0]);
}
