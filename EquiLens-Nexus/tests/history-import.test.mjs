import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {importSupplements} from '../lib/history-import.mjs';
const s={version:1,market:'TW',stockId:'2330',from:'2026-09-01',to:'2026-09-03',calendar:['2026-09-01'],segments:[],gaps:[],notes:[]};
test('import creates only separate supplements, is idempotent, and refuses changed existing files',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'history-import-'));
 try{fs.mkdirSync(path.join(dir,'stocks'));const f=path.join(dir,'stocks/2330.json');fs.writeFileSync(f,'ORIGINAL\n');assert.equal(importSupplements(dir,[s]).added,1);assert.equal(fs.readFileSync(f,'utf8'),'ORIGINAL\n');assert.equal(importSupplements(dir,[s]).skipped,1);assert.throws(()=>importSupplements(dir,[{...s,notes:['changed']}]),/existing/);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'history-supplements/TW/2330.json'))).notes,[]);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('validation finishes before any files are imported',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'history-invalid-'));
 try{assert.throws(()=>importSupplements(dir,[s,{...s,stockId:'../secrets'}]));assert.equal(fs.existsSync(path.join(dir,'history-supplements/TW/2330.json')),false);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
