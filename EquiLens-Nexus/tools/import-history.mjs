import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {importSupplements} from '../lib/history-import.mjs';
const input=process.argv[2],directory=process.argv[3] || process.env.EQUITY_DATA_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../.local');
if (!input) throw new Error('Usage: node tools/import-history.mjs bundle.json [data-directory]');
console.log(JSON.stringify(importSupplements(directory,JSON.parse(fs.readFileSync(input,'utf8')))));
