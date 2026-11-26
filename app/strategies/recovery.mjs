import {digest,fail,rows} from './contracts.mjs';
// Invoke in the existing restore writer, alongside Workspace/role/Budget safety.
// Retain consumed operations and exact attempts; never revive a ready old stage.
export function mergeStrategySafety(restored,current){
  for(const e of current.events.filter(e=>e.type?.startsWith('strategy.'))){const old=restored.events.find(x=>x.id===e.id);if(old&&old.type!==e.type)fail('STRATEGY_RESTORE_CONFLICT','Strategy identity conflict',409);if(old)Object.assign(old,structuredClone(e));else restored.events.push(structuredClone(e));}
  for(const receipt of current.receipts.filter(r=>r.type==='strategy.receipt')){const old=restored.receipts.find(r=>r.operationId===receipt.operationId);if(old&&digest(old)!==digest(receipt))fail('STRATEGY_RESTORE_CONFLICT','Consumed strategy operation conflict',409);if(!old)restored.receipts.push(structuredClone(receipt));}
  for(const r of current.runs.filter(r=>r.strategyContext)){const old=restored.runs.find(x=>x.id===r.id);if(old&&old.attemptId!==r.attemptId)fail('STRATEGY_RESTORE_CONFLICT','Attempt conflict',409);const copy=structuredClone(r);if(!['completed','failed','cancelled','interrupted','stopped','rolled_back'].includes(copy.status))copy.status='unknown';if(old)Object.assign(old,copy);else restored.runs.push(copy);}
  for(const g of rows(restored,'strategy')){g.restoreReviewRequired=true;g.status=g.selection?'selected':'unknown';}
  for(const c of rows(restored,'claim'))c.restoreReviewRequired=true;
  for(const o of rows(restored,'operation'))if(o.status==='pending')o.status='unknown';return restored;
}
