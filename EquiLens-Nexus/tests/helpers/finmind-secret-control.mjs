// Test-only OS secret replacement: all values stay in this child process.
import {register} from 'node:module';
import './finmind-access-offline.mjs';
const source=`
import fs from 'node:fs';import path from 'node:path';
let token='synthetic-existing-key';
const file=name=>path.join(process.env.EQUITY_DATA_DIR,name);
async function hold(action){
 fs.writeFileSync(file('entered-'+action),'');
 while(fs.existsSync(file('hold-'+action)))await new Promise(r=>setTimeout(r,10));
 if(fs.existsSync(file('fail-'+action)))throw Error('synthetic secret failure');
}
export const secretBackend=()=> 'file';
export const secretConfigured=name=>name==='finmind'&&!!token;
export const getSecret=async name=>name==='finmind'?token:'';
export async function saveSecret(name,value){if(name!=='finmind')throw Error('unexpected secret');await hold('save');token=value;}
export async function deleteSecret(name){if(name!=='finmind')throw Error('unexpected secret');await hold('remove');token='';}
`;
const loader=`export async function load(url,context,next){if(url.endsWith('/lib/secrets.mjs'))return {format:'module',shortCircuit:true,source:${JSON.stringify(source)}};return next(url,context);}`;
register('data:text/javascript,'+encodeURIComponent(loader),import.meta.url);
