import {records,changed,digest,fail} from './contracts.mjs';

/** Lead calls inside its FULL metadata restore transaction before assignment.
 * The current canonical ledger wins over an older snapshot. Never restore away
 * acknowledged observations, reservations or Stop delivery tombstones. */
export function mergeBudgetSafety(restored,current){
  const live= current.events.filter(e=>e.type?.startsWith('budget.'));
  const byId=new Map(restored.events.filter(e=>e.type?.startsWith('budget.')).map(e=>[e.id,structuredClone(e)]));
  for(const e of live)byId.set(e.id,structuredClone(e));
  for(const r of byId.values())if(r.type==='budget.reservation'){
    // Even a valid restored reservation must not become a dispatch grant.
    r.restored=true;delete r.reconciledAfterRestore;if(r.held)r.status='unknown';changed(r);
  }
  restored.events=[...restored.events.filter(e=>!e.type?.startsWith('budget.')),...byId.values()];
  const receiptMap=new Map(restored.receipts.filter(r=>r.type?.startsWith('budget.')).map(r=>[r.operationId,r]));
  for(const r of current.receipts.filter(r=>r.type?.startsWith('budget.')))receiptMap.set(r.operationId,structuredClone(r));
  restored.receipts=[...restored.receipts.filter(r=>!r.type?.startsWith('budget.')),...receiptMap.values()];
  // Current attempt identity/status must survive snapshot rollback as well. This
  // preserves observations without re-acquiring a run or changing its owner.
  const runIds=new Set(records(current,'reservation').map(r=>r.binding.runId));
  const runs=new Map(restored.runs.map(r=>[r.id,r]));for(const r of current.runs.filter(r=>runIds.has(r.id)))runs.set(r.id,structuredClone(r));restored.runs=[...runs.values()];
  return restored;
}

/** Optional lead preflight: restored holds need native reconciliation; they are
 * never released from a status label or an empty snapshot. */
export function assertBudgetLedger(s){
  const keys=new Set();for(const o of records(s,'observation')){
    const key=digest([o.binding.providerInstanceId,o.sourceReceiptId]);if(keys.has(key))fail('BUDGET_RECEIPT_REUSE','Restored ledger repeats a source receipt',409);keys.add(key);
  }
  return true;
}
