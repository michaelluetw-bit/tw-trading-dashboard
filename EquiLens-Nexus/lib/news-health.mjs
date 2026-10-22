// Each news source owns its success, error and retry state.
const stamp=v=>Number.isFinite(v)&&v>0?v:null;
const empty=()=>({lastAttempt:null,lastSuccess:null,lastNew:null,error:'',pausedUntil:null});
export function createNewsHealth(saved={}) {
 return Object.fromEntries(Object.entries(saved||{}).map(([id,s])=>[id,{lastAttempt:stamp(s?.lastAttempt),lastSuccess:stamp(s?.lastSuccess),lastNew:stamp(s?.lastNew),error:typeof s?.error==='string'?s.error:'',pausedUntil:stamp(s?.pausedUntil)}]));
}
export async function fetchNewsSource(state,id,request,{now}={}) {
 const time=()=>now??Date.now();
 const s=state[id]??=empty();
 if(s.pausedUntil>time())return [];
 s.lastAttempt=time();
 try {const rows=await request();s.lastSuccess=time();s.error='';s.pausedUntil=null;return rows;}
 catch(e){s.error=e.message||String(e);s.pausedUntil=['auth','quota','plan','forbidden'].includes(e.code)?time()+30*60e3:null;return [];}
}
export function newsSourceInfo(state,id,{enabled=true,now=Date.now(),retryAt=0}={}) {
 const s=state[id]||empty(),pausedUntil=Math.max(s.pausedUntil||0,retryAt||0)>now?Math.max(s.pausedUntil||0,retryAt||0):null;
 return {provider:id,...s,pausedUntil,enabled,status:!enabled?'disabled':pausedUntil?'paused':s.error?'error':s.lastSuccess?'ok':'waiting',retryAt:enabled?(pausedUntil||(s.error&&s.lastAttempt?s.lastAttempt+60e3:null)):null};
}
