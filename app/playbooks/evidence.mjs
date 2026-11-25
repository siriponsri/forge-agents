import {find,fail,digest,exact,text} from './contracts.mjs';
import {fileBytes,snapshot,verifier,confined} from '../missions/contracts.mjs';
import {validateDefinition,ownedRun} from '../goals/contracts.mjs';

// Observes canonical records and bounded files. It never executes a verifier or
// accepts delivery. Failed verifier results can also support a review finding.
export async function resolveEvidence(s,w,refs){
  if(!Array.isArray(refs)||!refs.length||refs.length>12)fail('EVIDENCE_REQUIRED','Select 1..12 exact Mission evidence groups');
  const m=find(s,'events',w.missionId,w.projectId);
  if(m.type!=='mission.definition'||m.definitionRevision!==w.missionDefinitionRevision||m.restoreReviewRequired||!m.goalId)fail('EVIDENCE_STALE','Use the linked, current, reviewed Mission revision',409);
  const g=find(s,'events',m.goalId,w.projectId);if(g.type!=='goal.goal')fail('EVIDENCE_SCOPE','Missing canonical Goal',409);validateDefinition(s,g);
  const p=find(s,'projects',w.projectId);let total=0;const seen=new Set(),out=[];
  for(const ref of refs){
    exact(ref,['runId','attemptId','artifactId','verificationId']);for(const k of ['runId','attemptId','artifactId','verificationId'])text(ref[k],k,200);
    if(seen.has(digest(ref)))fail('EVIDENCE_SCOPE','Duplicate evidence group');seen.add(digest(ref));
    const r=find(s,'runs',ref.runId,w.projectId),a=g.attempts.find(a=>a.operationId===r.operationId);
    if(!a||a.context.goalRevision!==g.goalRevision||ownedRun(s,g,a)?.id!==r.id||r.attemptId!==ref.attemptId||r.status!=='completed'||!r.selection?.model||!r.selection?.instanceId)fail('EVIDENCE_SCOPE','Choose an exact completed Mission/Goal/T3 attempt with observed provider selection',409);
    const v=find(s,'events',ref.verificationId,w.projectId),artifact=find(s,'artifacts',ref.artifactId,w.projectId);
    const x=s.events.find(x=>x.type==='mission.output'&&x.projectId===w.projectId&&x.missionId===m.id&&x.definitionRevision===m.definitionRevision&&x.artifactId===artifact.id&&x.runId===r.id&&x.attemptId===r.attemptId&&x.id===v.outputId);
    const o=x&&m.definition.outputs.find(o=>o.key===x.outputKey&&m.taskIds[o.key]===r.taskId);
    if(!o||v.type!=='verification.result'||v.missionId!==m.id||v.definitionRevision!==m.definitionRevision||v.runId!==r.id||v.attemptId!==r.attemptId||v.verifier?.id!==verifier(m,o).id||v.verifier?.version!==verifier(m,o).version||!['PASSED','FAILED'].includes(v.status)||!v.checkedAt||!v.checks?.length)fail('EVIDENCE_SCOPE','Select a real versioned Mission verifier observation linked to this output',409);
    const bytes=await fileBytes(p.workspace,o.path),sourceFiles=await snapshot(p.workspace,o);
    if(await confined(p.workspace,artifact.path)!==bytes.path||artifact.sha256!==x.sha256)fail('EVIDENCE_STALE','Artifact registration changed',409);
    total+=sourceFiles.reduce((n,f)=>n+f.bytes,0);if(total>64*1024*1024)fail('EVIDENCE_SIZE','Review at most 64 MiB of source files');
    if(bytes.sha256!==x.sha256||bytes.bytes.length!==x.bytes||digest(sourceFiles)!==digest(v.sourceFiles))fail('EVIDENCE_STALE','Artifact, source or verifier file bytes changed; register and verify the new revision',409);
    out.push({ref:structuredClone(ref),missionId:m.id,missionDefinitionRevision:m.definitionRevision,goalId:g.id,goalRevision:g.goalRevision,taskId:r.taskId,provider:structuredClone(r.selection),artifact:{path:o.path,sha256:bytes.sha256,bytes:bytes.bytes.length},sourceFiles,verifierStatus:v.status,
      records:['mission','goal','run','output','artifact','verification'].map((kind,i)=>{const item=[m,g,r,x,artifact,v][i];return {kind,id:item.id,revision:item.revision,sha256:digest(item)};})});
  }
  return out;
}
export async function recheckReview(s,w,review){
  if(review.workflowId!==w.id||review.briefId!==w.briefId||review.missionId!==w.missionId)fail('EVIDENCE_STALE','Review belongs to an earlier workflow brief or Mission',409);
  const observed=await resolveEvidence(s,w,review.evidence.map(e=>e.ref));
  if(digest(observed)!==digest(review.evidence))fail('EVIDENCE_STALE','Reviewed record revisions or bytes changed; submit a new review',409);
  return observed;
}
