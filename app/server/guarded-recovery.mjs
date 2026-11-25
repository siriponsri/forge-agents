import {digest} from '../guarded-runtime/profile.mjs';
import {fail} from './domain.mjs';

// Canonical effect/dispatch identities outlive configuration restores. No lease,
// credential, native session authority or executable path is reconstructed here.
export function mergeGuardedSafety(restored,current){
  const runs=current.runs.filter(r=>r.guardedContext),ids=new Set(runs.map(r=>r.id));
  for(const run of runs){const index=restored.runs.findIndex(r=>r.id===run.id);if(index<0)restored.runs.push(structuredClone(run));else restored.runs[index]=structuredClone(run);}
  for(const old of restored.runs.filter(r=>r.guardedContext&&!ids.has(r.id))){if(['submitting','running'].includes(old.status))old.status='unknown';old.guardedDispatch={status:'unknown',reason:'restored-without-private-lease'};}
  for(const name of ['events','receipts'])for(const row of current[name].filter(e=>e.type==='guarded.file-receipt'||e.type==='agui'&&ids.has(e.runId))){
    const prior=restored[name].find(e=>e.id===row.id);if(prior&&digest(prior)!==digest(row))fail('GUARDED_RESTORE_CONFLICT','Guarded effect history conflicts with this snapshot',409);
    if(!prior)restored[name].push(structuredClone(row));
  }
  return restored;
}
