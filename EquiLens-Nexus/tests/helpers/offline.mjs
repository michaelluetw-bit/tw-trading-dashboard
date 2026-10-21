// Preload in parent and spawned Node tests. Local fixture servers only.
import net from 'node:net';
import child from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
const allowed=h=>['127.0.0.1','::1','localhost'].includes(h);
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
  const a=Array.isArray(args[0])?args[0]:args;
  const o=typeof a[0]==='object'?a[0]:{host:typeof a[1]==='string'?a[1]:'localhost'};
  if(o.path||!allowed(o.host||'localhost'))throw new Error('OFFLINE: non-loopback socket blocked');
  return connect.apply(this,args);
};
const originalFetch=globalThis.fetch;
globalThis.fetch=(url,...args)=>{
  if(!allowed(new URL(typeof url==='string'||url instanceof URL?url:url.url).hostname))throw new Error('OFFLINE: external fetch blocked');
  return originalFetch(url,...args);
};
for(const method of ['spawn','spawnSync','execFile','execFileSync','exec','execSync']) {
  const original=child[method];child[method]=function(command,...args){
    if(/security|secret-tool|powershell|curl|wget/i.test(String(command)))throw new Error('OFFLINE: credential/network command blocked');
    return original.call(this,command,...args);
  };
}
syncBuiltinESMExports();
