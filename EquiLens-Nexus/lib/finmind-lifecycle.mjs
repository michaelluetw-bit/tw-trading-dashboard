// Serialize credential changes; the OS secret store and JSON are not a transaction.
import { DataError } from './providers/common.mjs';
export function createCredentialLifecycle({access,readSecret,saveSecret,deleteSecret,validate,envManaged}) {
  let tail=Promise.resolve();
  const run=fn=>{const pending=tail.then(fn);tail=pending.catch(()=>{});return pending;};
  const disableIncompleteChange=()=>{const s=access.view();if(s.credential==='changing')access.finishChange(s.generation,'disabled');};
  const retryOperations=()=>run(async()=>access.resetOperationPauses());
  const replace=key=>run(async()=>{
    if(envManaged())throw new DataError('FinMind 金鑰由環境變數管理，請先調整啟動環境',null,{status:409});
    const ticket=access.capture('/v2/user_info',true);
    const info=await validate(key,{candidate:true});access.assertCurrent(ticket);
    const generation=access.beginChange();
    try{await saveSecret(key);access.finishChange(generation,'valid');}
    catch{disableIncompleteChange();throw new DataError('金鑰儲存未完成，FinMind 已停用，請重新驗證');}
    return info;
  });
  const recheck=()=>run(async()=>{
    const ticket=access.capture('/v2/user_info',true),key=await readSecret();access.assertCurrent(ticket);
    if(!key)throw new DataError('FinMind 尚未設定金鑰',null,{code:'auth'});
    const info=await validate(key,{candidate:false});access.assertCurrent(ticket);
    const generation=access.beginChange();access.finishChange(generation,'valid');return info;
  });
  const disable=()=>run(async()=>{const generation=access.beginChange();access.finishChange(generation,'disabled');});
  const remove=()=>run(async()=>{
    const generation=access.beginChange();
    try{await deleteSecret();access.finishChange(generation,envManaged()?'disabled':'missing');}
    catch{disableIncompleteChange();throw new DataError('金鑰移除未完成，FinMind 已停用');}
  });
  return {replace,recheck,disable,remove,retryOperations};
}
