import {fail,records,activeWorkspace} from './contracts.mjs';

// Shared restore integration must call this before swapping domain metadata.
// It also covers the reservation gap before T3 has a canonical run record.
export function assertWorkspaceRestoreAvailable(s){
  if(records(s,'workspace').some(w=>activeWorkspace(w)||['creating','creation-unknown'].includes(w.status))||records(s,'operation').some(o=>o.status==='pending')||records(s,'integration').some(q=>['preparing','checking','committing','unknown'].includes(q.status)))fail('RESTORE_BUSY','Reconcile active/uncertain workspace operations before restoring metadata',409);
}

// Like a receipt/tombstone ledger, acknowledged workspace effect identities must
// survive restoring an older snapshot. This does not recreate Git files or T3
// turns, and does not grant a restored backup authority to dispatch old work.
export function mergeWorkspaceSafety(restored,current){
  const live=current.events.filter(e=>e.type?.startsWith('workspace.')),byId=new Map(live.map(e=>[e.id,e]));
  const historic=restored.events.filter(e=>e.type?.startsWith('workspace.')&&!byId.has(e.id)).map(e=>{
    const copy=structuredClone(e);copy.restoreReviewRequired=true;
    if(copy.type==='workspace.workspace')copy.status='restored';
    if(copy.type==='workspace.operation'&&copy.status==='pending')copy.status='unknown';
    if(copy.type==='workspace.integration'&&copy.status!=='integrated')copy.status='unknown';
    return copy;
  });
  restored.events=[...restored.events.filter(e=>!e.type?.startsWith('workspace.')),...historic,...structuredClone(live)];
  const operations=new Set(live.filter(e=>e.type==='workspace.operation').map(e=>e.operationId));
  const receipts=current.receipts.filter(r=>operations.has(r.operationId));
  restored.receipts=[...restored.receipts.filter(r=>!operations.has(r.operationId)),...structuredClone(receipts)];
  const workspaces=live.filter(e=>e.type==='workspace.workspace'),runOperations=new Set(workspaces.map(w=>w.runOperationId).filter(Boolean));
  const runs=current.runs.filter(r=>runOperations.has(r.operationId)),runIds=new Set(runs.map(r=>r.id));
  restored.runs=[...restored.runs.filter(r=>!runIds.has(r.id)&&!runOperations.has(r.operationId)),...structuredClone(runs)];
  return restored;
}
