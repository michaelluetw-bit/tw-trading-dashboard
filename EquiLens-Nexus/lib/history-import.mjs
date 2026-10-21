import fs from 'node:fs';
import path from 'node:path';
import {validateSupplement} from './history.mjs';
export function importSupplements(directory, bundle) {
  if (!Array.isArray(bundle) || bundle.length > 10000) throw new Error('invalid history bundle');
  const seen = new Set();
  const pending = bundle.map(s => {
    if (!/^[A-Z]{2,5}$/.test(s.market)) throw new Error('invalid history market');
    validateSupplement(s,s.stockId,s.market);
    const key = `${s.market}/${s.stockId}`;
    if (seen.has(key)) throw new Error('duplicate history identity'); seen.add(key);
    const file = path.join(directory,'history-supplements',s.market,`${s.stockId}.json`);
    const text = JSON.stringify(s);
    if (Buffer.byteLength(text) > 5_000_000) throw new Error('history too large');
    if (fs.existsSync(file)) {
      if (JSON.stringify(JSON.parse(fs.readFileSync(file,'utf8'))) !== text) throw new Error(`existing supplement differs: ${key}`);
      return null;
    }
    return {file,text};
  });
  for (const item of pending.filter(Boolean)) {
    fs.mkdirSync(path.dirname(item.file),{recursive:true});
    fs.writeFileSync(item.file,item.text,{flag:'wx'});
  }
  return {added:pending.filter(Boolean).length,skipped:pending.filter(x=>!x).length};
}
