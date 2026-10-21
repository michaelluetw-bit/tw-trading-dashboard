// Non-secret state. Never infer entitlements from numeric levels or request limits.
import { read, write } from './storage.mjs';
import { DataError } from './providers/common.mjs';
export const ACCESS_FILE = 'finmind-access.json';
export const PLANS = ['free', 'backer', 'sponsor'];
export function confirmedPlan(evidence) {
  return evidence?.source === 'official-account' && evidence?.confirmedAt && PLANS.includes(evidence.plan) ? evidence.plan : 'unknown';
}
// Pricing/Technical docs checked 2026-10-21. Unverified chip entitlements stay unknown.
export const REQUIREMENTS = { universe:'free', calendar:'free', daily:'free', adjusted:'backer', dailyAll:'backer', dailyAllAdjusted:'backer', valuation:'free', revenue:'free', institutional:'free', flows:'free', futures:'free', margin:'free', news:'free', snapshot:'sponsor', intraday:'sponsor' };
export function allows(plan, cap) { const need=REQUIREMENTS[cap]; return !!need && (need==='free'&&plan==='unknown'||PLANS.indexOf(plan)>=PLANS.indexOf(need)); }
export function createAccess({load,save,now=Date.now}) {
  const state=()=>load() || {credential:'unverified',entitlement:null};
  function assert({validation=false,candidate=false}={}) {
    const s=state();
    if (!(candidate&&validation||s.credential==='valid'||validation&&s.credential==='unverified')) throw new DataError('FinMind 憑證未啟用，已停止請求',null,{fatal:true,code:'auth'});
    if ((s.retryAt||0)>now()) throw new DataError('FinMind 額度或頻率限制，已保留進度，稍後可續傳',null,{fatal:true,code:'quota'});
    return s;
  }
  function fail(code) { const s=state(); if(code==='missing'&&s.credential!=='revoked')save({...s,credential:'missing'}); if(code==='auth'&&s.credential!=='revoked')save({...s,credential:'auth_failed'}); if(code==='quota')save({...s,retryAt:now()+3600e3}); }
  function activate() {save({credential:'valid',entitlement:null});}
  function confirmEntitlement(evidence) {if(confirmedPlan(evidence)==='unknown')throw new Error('Unconfirmed FinMind entitlement');save({...state(),entitlement:evidence});}
  return {state,assert,fail,activate,confirmEntitlement};
}
export const access=createAccess({load:()=>read(ACCESS_FILE,null),save:s=>write(ACCESS_FILE,s)});
export function responseCode(httpStatus,bodyStatus,message='') {
  const statuses=[httpStatus,Number(bodyStatus)||200].filter(s=>s!==200);
  const codes=statuses.map(s=>classifyResponse(s,message));
  return ['auth','quota','forbidden','data'].find(c=>codes.includes(c))||null;
}
export function classifyResponse(status,message='') {
  // Explicit authentication messages take priority over generic 400/402 errors.
  if(status===401 || status===400&&/token.*(invalid|illegal|expired|revoke)|(?:invalid|illegal|expired|revoke).*token|please update your token|unauthori[sz]ed|authentication/i.test(message))return 'auth';
  if(status===402||status===429||/rate.?limit|quota|request.*limit|次數.*上限/i.test(message))return 'quota';
  if(status===403)return 'forbidden';
  return 'data';
}
