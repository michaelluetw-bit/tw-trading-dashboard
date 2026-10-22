// FinMind access state contains no credential values. Unknown entitlement is not a denial.
import fs from 'node:fs';
import path from 'node:path';
import { LOCAL, read, write } from './storage.mjs';
import { secretConfigured } from './secrets.mjs';
import { DataError, stopped } from './providers/common.mjs';
export const ACCESS_FILE = 'finmind-access.json';
const COOLDOWN = 30 * 60e3;
const SPLIT = new Set(['TaiwanStockPrice','TaiwanStockPriceAdj','TaiwanStockInstitutionalInvestorsBuySell','TaiwanStockNews','TaiwanStockHoldingSharesPer','TaiwanStockInfoWithWarrantSummary']);
export const operationKey = (dataset, params = {}) => dataset + (SPLIT.has(dataset) ? (params.data_id ? ':symbol' : ':all') : '');
export function classifyResponse(http, business, message = '') {
  const statuses = [http, Number(business)].filter(Number.isFinite);
  if (statuses.includes(401) || /token.*(invalid|illegal|expired|revoked)|(?:invalid|illegal|expired|revoked).*token|please update your token/i.test(message)) return 'auth';
  if (statuses.some(s => s === 402 || s === 429) || /quota|rate.?limit|request.*limit|次數.*上限/i.test(message)) return 'quota';
  if (statuses.includes(403)) return 'forbidden';
  if (/your level|user level|sponsor/i.test(message)) return 'plan';
  return 'data';
}
export function retryDeadline(header, now = Date.now()) {
  const delay = /^\d+$/.test(header || '') ? Number(header) * 1000 : Date.parse(header) - now;
  return now + (Number.isFinite(delay) && delay >= 0 && delay <= 864e5 ? delay : COOLDOWN);
}
const timestamp = v => Number.isFinite(v) && v >= 0 ? v : null;
const credentials = new Set(['missing','legacy_unverified','valid','disabled','auth_failed','changing']);
export function createAccess({ load, save, now = Date.now }) {
  let state;
  const listeners = new Set();
  const fresh = (credential, caps = []) => ({version:1,credential,generation:0,retryAt:null,lastCode:null,lastAttemptAt:null,validatedAt:null,legacyBlockedCaps:caps,entitlement:{status:'unknown'},operations:{}});
  const persist = () => { save(structuredClone(state)); };
  const changed = () => { for (const fn of listeners) fn(state.generation); };
  function initialize({ present, legacyBlockedCaps = [] }) {
    if (state) return view();
    const saved = load();
    if (saved === undefined) state = fresh(present ? 'legacy_unverified' : 'missing', legacyBlockedCaps);
    else if (!saved || typeof saved !== 'object' || Array.isArray(saved) || saved.version !== 1 || !credentials.has(saved.credential) || !Number.isSafeInteger(saved.generation) || saved.generation < 0) state = fresh('disabled');
    else {
      state = {...fresh(saved.credential),generation:saved.generation,retryAt:timestamp(saved.retryAt),lastAttemptAt:timestamp(saved.lastAttemptAt),validatedAt:timestamp(saved.validatedAt),lastCode:['auth','quota','forbidden','plan'].includes(saved.lastCode)?saved.lastCode:null,
        legacyBlockedCaps:Array.isArray(saved.legacyBlockedCaps)?saved.legacyBlockedCaps.filter(x=>typeof x==='string'):[],operations:{}};
      for (const [key, value] of Object.entries(saved.operations || {})) {
        if (!value || !['unknown','allowed_observed','denied'].includes(value.status) || key.length > 100) continue;
        state.operations[key] = {status:value.status,observedAt:timestamp(value.observedAt),retryAt:timestamp(value.retryAt),code:['forbidden','plan'].includes(value.code)?value.code:null};
      }
      if (state.credential === 'changing') { state.credential = 'disabled'; state.generation++; }
    }
    persist(); return view();
  }
  function view() { return structuredClone(state); }
  function assertCurrent(ticket) {
    if (ticket.generation !== state.generation) throw stopped();
    if ((state.retryAt || 0) > now()) throw new DataError('FinMind 額度暫停，請於可重試時間後再試', null, {code:'quota',fatal:true});
    if (!ticket.validation && !['valid','legacy_unverified'].includes(state.credential)) throw new DataError('FinMind 憑證已停用，請重新驗證', null, {code:'auth',fatal:true});
    if (!ticket.validation) {
      const op = state.operations[ticket.operation];
      if (op?.status === 'denied' && op.retryAt > now()) throw new DataError(op.code==='plan'?'FinMind 此項資料遭來源拒絕（Sponsor 權限）':'FinMind 此項資料暫停，其他能力仍可使用', null, {code:op.code || 'forbidden'});
    }
  }
  function capture(operation, validation = false) {
    const ticket = {generation:state.generation,operation,validation}; assertCurrent(ticket); return ticket;
  }
  function record(ticket, {kind, retryAt}) {
    if (ticket.generation !== state.generation) return;
    state.lastAttemptAt = now();
    if (kind === 'success') {
      if (!ticket.validation && state.credential === 'legacy_unverified') state.credential = 'valid';
      state.operations[ticket.operation] = {status:'allowed_observed',observedAt:now(),retryAt:null,code:null};
    } else if (kind === 'auth') { state.credential = 'auth_failed'; state.lastCode = 'auth'; state.generation++; }
    else if (kind === 'quota') { state.retryAt = retryAt ?? now()+COOLDOWN; state.lastCode = 'quota'; }
    else if (kind === 'forbidden' || kind === 'plan') { state.operations[ticket.operation] = {status:'denied',observedAt:now(),retryAt:now()+COOLDOWN,code:kind};state.lastCode=kind; }
    persist(); if (kind === 'auth') changed();
  }
  function beginChange() {state.credential='changing';state.generation++;persist();changed();return state.generation;}
  function finishChange(generation, credential) {
    if (generation !== state.generation) throw stopped();
    if (!['valid','missing','disabled'].includes(credential)) throw new Error('Invalid credential transition');
    state.credential=credential;
    if (credential === 'valid') {state.legacyBlockedCaps=[];state.operations={};state.retryAt=null;state.lastCode=null;state.validatedAt=now();}
    persist();
  }
  function resetOperationPauses() { for(const op of Object.values(state.operations))op.retryAt=null;state.generation++;persist();changed(); }
  return {initialize,view,capture,assertCurrent,record,beginChange,finishChange,resetOperationPauses,onGenerationChange:fn=>listeners.add(fn)};
}
export const access = createAccess({load:()=>fs.existsSync(path.join(LOCAL,ACCESS_FILE))?read(ACCESS_FILE,{version:0}):undefined,save:state=>write(ACCESS_FILE,state)});
export function finmindAccess() {
  const legacy = read('provider-info.json',{}).finmind?.tier === 'free' ? ['dayTrade','dailyAll','snapshot','intraday','marketNews','institutionalAll','brokers'] : [];
  access.initialize({present:secretConfigured('finmind','FINMIND_API_TOKEN'),legacyBlockedCaps:legacy});
  return access;
}
export function effectiveRetryAt(state, operations = [], local = 0) {
  return Math.max(local || 0, state.retryAt || 0, ...operations.map(key=>state.operations[key]?.retryAt || 0)) || null;
}
