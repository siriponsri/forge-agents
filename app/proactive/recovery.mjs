import {changed} from './contracts.mjs';

// Metadata rollback must not roll back consumed events, task attempts, Stop or
// delivery identities. Grants are invalidated in the same canonical restore
// transaction; preserving history grants no permission to execute again.
export function mergeProactiveSafety(restored,current){
  const isProactive=e=>e.type?.startsWith('proactive.');
  const live=current.events.filter(isProactive),ids=new Set(live.map(e=>e.id));
  const history=[...restored.events.filter(e=>isProactive(e)&&!ids.has(e.id)),...live].map(e=>{
    const copy=structuredClone(e);
    if(copy.type==='proactive.recipe'){
      copy.grant=null;copy.nextDue=null;copy.restoreReviewRequired=true;
      if(['enabled','approved'].includes(copy.status)||e.grant)copy.status='needs_approval';
      changed(copy);
    }
    if(!ids.has(e.id)&&copy.type==='proactive.occurrence'){
      copy.restoreReviewRequired=true;
      if(copy.dispatchedAt!==undefined&&copy.held)copy.status='unknown';
      else if(['scheduled','claimed'].includes(copy.status)){copy.status='cancelled';copy.held=false;}
    }
    return copy;
  });
  restored.events=[...restored.events.filter(e=>!isProactive(e)),...history];
  const receipts=current.receipts.filter(r=>r.type==='proactive.command'),operations=new Set(receipts.map(r=>r.operationId));
  restored.receipts=[...restored.receipts.filter(r=>!operations.has(r.operationId)),...structuredClone(receipts)];
  const occurrences=live.filter(e=>e.type==='proactive.occurrence'),runOperations=new Set(occurrences.map(o=>o.operationId).filter(Boolean)),runIds=new Set(occurrences.map(o=>o.runId).filter(Boolean));
  const runs=current.runs.filter(r=>r.proactiveContext||runOperations.has(r.operationId)||runIds.has(r.id));
  for(const run of runs){runIds.add(run.id);runOperations.add(run.operationId);}
  restored.runs=[...restored.runs.filter(r=>!runIds.has(r.id)&&!runOperations.has(r.operationId)),...structuredClone(runs)];
  return restored;
}
