import {validateProactiveContext,validateProactiveAction} from '../proactive/context.mjs';
import {validateProactiveEnforcement} from '../proactive/enforcement.mjs';
import {digest,fail} from './profile.mjs';

// Read-only bridge to existing canonical rules. The lead owns installation into
// its reservation/dispatch/lifecycle fence. No new run or turn owner lives here.
export function canonicalGuard({snapshot,currentProof,ordinaryGovernance,clock=Date.now}){
  return ({profile,capability,path,phase='action',reservation})=>{
    const s=snapshot();if(s?.then)fail('SYNCHRONOUS_SNAPSHOT_REQUIRED');
    const run=s.runs.find(r=>r.id===profile.runId&&r.projectId===profile.projectId&&r.taskId===profile.taskId);
    if(!run)fail('CANONICAL_RUN_REQUIRED');
    const input={projectId:profile.projectId,taskId:profile.taskId,proactiveContext:run.proactiveContext};
    const proof=currentProof(profile);if(!proof||proof.then)fail('NATIVE_ENFORCEMENT_UNQUALIFIED');
    validateProactiveEnforcement(s,input,proof,clock);
    if(proof.projectId!==profile.projectId||proof.taskId!==profile.taskId||proof.envelopeDigest!==profile.envelopeDigest||proof.identitySnapshot!==profile.identitySnapshot||digest(run.proactiveContext?.scope)!==digest({paths:profile.scope.paths,capabilities:profile.scope.capabilities})||run.proactiveContext?.envelopeDigest!==profile.envelopeDigest)fail('CANONICAL_SCOPE_CHANGED');
    if(phase==='reservation')validateProactiveContext(s,reservation,clock);
    else validateProactiveAction(s,{projectId:profile.projectId,runId:run.id,capability,path},clock);
    return ordinaryGovernance({s,run,capability,path})===true;
  };
}
