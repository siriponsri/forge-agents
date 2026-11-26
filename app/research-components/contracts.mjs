import {randomUUID} from 'node:crypto';
import {append,record,records,verifyTrial,digest,bytesDigest,fail,exact} from '../research/contracts.mjs';
import {buildResearchContext,researchContextPolicy} from '../research/context.mjs';
import {approvedTask,contextFor,taskSignature,planSignature,terminal,assertNoMixedControllers} from '../workspaces/contracts.mjs';
import {snapshotSkill} from '../adaptive/records.mjs';
import {validateDecision} from '../adaptive/selection.mjs';
import {validateCohortRoute} from './routes.mjs';
export {digest,bytesDigest,fail,exact,terminal,records};

export function seal(state,kind,data,projectId,clock=Date.now){
  const e=append(state,kind,data,projectId,clock);e.digest=digest({...e,digest:undefined});return e;
}
export function intact(e){if(!e||digest({...e,digest:undefined})!==e.digest)fail('RESEARCH_COMPONENT_INTEGRITY','Append-only component receipt changed',409);return e;}
export function trialFor(s,projectId,trialId){const t=record(s,'trial',trialId,projectId);verifyTrial(t,record(s,'experiment',t.manifest.experimentId,projectId));if(t.manifest.execution!=='agent'||t.manifest.fault!=='none')fail('RESEARCH_COMPONENT_SCOPE','Components require agent execution without injected native faults',409);return t;}
export function compositionFor(s,projectId,trialId){const all=records(s,'composition',projectId).filter(e=>e.trialId===trialId);if(all.length>1)fail('RESEARCH_COMPONENT_INTEGRITY','Ambiguous trial composition',409);return all[0]?intact(all[0]):null;}
export function allocationsFor(s,c){return records(s,'allocation',c.projectId).filter(a=>a.compositionId===c.id).map(intact);}
export function stopped(s,c){return records(s,'component-stop',c.projectId).some(e=>{intact(e);return e.compositionId===c.id;});}
export function workspaceFor(s,id,projectId){const w=s.events.find(e=>e.type==='workspace.workspace'&&e.projectId===projectId&&e.id===id);if(!w)fail('RESEARCH_COMPONENT_SCOPE','Canonical isolated workspace required',409);return w;}
export function runFor(s,a){
  const runs=s.runs.filter(r=>r.operationId===a.operationId);if(runs.length>1)fail('RESEARCH_COMPONENT_SCOPE','Ambiguous canonical run',409);const r=runs[0];if(!r)return null;
  const w=workspaceFor(s,a.workspaceId,a.projectId);
  if(!r.attemptId||r.projectId!==a.projectId||r.taskId!==a.taskId||(r.botId??null)!==a.botId||digest(r.workspaceContext??null)!==digest(contextFor(w))||digest(r.researchComponentContext??null)!==digest(contextForAllocation(a))||digest(r.researchContext??null)!==digest(buildResearchContext(s,{projectId:a.projectId,trialId:a.trialId}))||digest(r.selection??null)!==digest(a.selection)||r.executedModel&&r.executedModel!==a.selection.model)fail('RESEARCH_COMPONENT_SCOPE','Run did not retain exact allocation, route, task, attempt and trial',409);
  return r;
}
export function contextForAllocation(a){return {version:1,compositionId:a.compositionId,allocationId:a.id,trialId:a.trialId,manifestDigest:a.manifestDigest,workspaceId:a.workspaceId,taskId:a.taskId,operationId:a.operationId,decisionId:a.decisionId,selection:a.selection,skills:a.skills,role:a.role,envelope:a.envelope,feedback:a.feedback};}

// Trusted root/native callback. No body-supplied record, path or membership is authority.
export function resolveResearchAllocation(s,{projectId,trialId,workspaceId,runOperationId,runId,attemptId}){
  const t=trialFor(s,projectId,trialId),c=compositionFor(s,projectId,trialId);if(!c){if(workspaceId!==t.manifest.workspaceId||runOperationId!==t.runOperationId)fail('RESEARCH_COMPONENT_SCOPE','Foreign ordinary primary request',409);return null;}
  if(c.manifestDigest!==t.manifestDigest)fail('RESEARCH_COMPONENT_INTEGRITY','Composition manifest changed',409);
  const all=allocationsFor(s,c),matches=all.filter(a=>a.workspaceId===workspaceId&&a.operationId===runOperationId);
  if(matches.length!==1)fail('RESEARCH_COMPONENT_SCOPE','Unclaimed or foreign cohort allocation',409);
  const a=matches[0],slot=c.slots.find(x=>x.workspaceId===a.workspaceId),w=workspaceFor(s,workspaceId,projectId),{task,plan}=approvedTask(s,projectId,a.taskId);
  if(a.trialId!==t.id||a.manifestDigest!==t.manifestDigest||!slot||slot.taskId!==task.id||w.taskId!==task.id||w.baseSha!==t.manifest.workspaceBase||slot.taskSignature!==taskSignature(task)||slot.planSignature!==planSignature(plan)||slot.workspaceDigest!==workspacePin(w)||a.operationId!==`workspace-run:${w.id}`||a.botId!==(task.botId??null)||digest(a.selection)!==digest(slot.selection)||digest(a.skills)!==digest(slot.skills)||digest(a.envelope)!==digest(slot.envelope))fail('RESEARCH_COMPONENT_SCOPE','Allocation does not match immutable approved cohort',409);
  if(!slot.enabled||a.role!==slot.role||all.length>t.manifest.limits.maxAgents)fail('RESEARCH_COMPONENT_SCOPE','Disabled or over-capacity allocation',409);
  const policyDecision=s.events.find(e=>e.type==='research.component-decision'&&e.id===a.policyDecisionId&&e.projectId===projectId);intact(policyDecision);
  if(policyDecision.compositionId!==c.id||policyDecision.manifestDigest!==t.manifestDigest||policyDecision.slotId!==w.id||policyDecision.evidenceId!==a.feedback.evidenceId||policyDecision.action!==a.feedback.reason)fail('RESEARCH_COMPONENT_DECISION','Allocation policy decision changed',409);
  if(a.feedback.evidenceId){const prior=all.find(other=>other.id!==a.id&&evidenceFor(s,c,other)?.id===a.feedback.evidenceId);if(!prior||prior.role==='helper'||evidenceFor(s,c,prior).status!=='FAILED')fail('RESEARCH_COMPONENT_EVIDENCE','Revision requires its exact independent predecessor failure',409);}
  const run=s.runs.find(r=>r.operationId===runOperationId);
  if(runId!==undefined&&(run?.id??null)!==runId||attemptId!==undefined&&(run?.attemptId??null)!==attemptId)fail('RESEARCH_COMPONENT_SCOPE','Foreign canonical run or attempt',409);
  if(run)runFor(s,a);
  return structuredClone({composition:c,allocation:a,workspace:w,task,trial:t,manifest:t.manifest,envelope:{trialId:t.id,manifestDigest:t.manifestDigest,limits:t.manifest.limits,deadlineAt:t.deadlineAt,allocationCount:all.length,allocationIds:all.map(x=>x.id)}});
}
export function workspacePin(w){return digest({id:w.id,projectId:w.projectId,taskId:w.taskId,botId:w.botId,baseSha:w.baseSha,sourceHeadSha:w.sourceHeadSha,worktreePath:w.worktreePath,profileDigest:w.profileDigest,taskSignature:w.taskSignature,planSignature:w.planSignature,botRevision:w.botRevision});}
export function validateSkills(s,c,slot){
  if(!c.components.skills&&slot.skills.length)fail('RESEARCH_COMPONENT_OFF','Skills OFF cannot consume instructions',409);
  for(const pin of slot.skills){const skill=s.skills.find(x=>x.id===pin.id&&x.projectId===c.projectId);if(!skill||skill.status!=='active'||digest(snapshotSkill(skill))!==digest(pin))fail('RESEARCH_COMPONENT_SKILL','Reviewed skill version changed',409);}
}
// BOTH T3 reservation and final dispatch; a narrow extra guard, never a bypass.
export function validateResearchComponentContext(s,input,clock=Date.now){
  const claimed=records(s,'allocation',input.projectId).find(a=>a.operationId===input.operationId||a.workspaceId===input.workspaceContext?.workspaceId);
  const pinned=records(s,'composition',input.projectId).find(c=>c.slots.some(slot=>slot.workspaceId===input.workspaceContext?.workspaceId));
  const context=input.researchComponentContext;
  if(context===undefined){if(claimed||pinned)fail('RESEARCH_COMPONENT_CONTEXT','Cohort admission cannot be stripped',409);return null;}
  exact(context,['version','compositionId','allocationId','trialId','manifestDigest','workspaceId','taskId','operationId','decisionId','selection','skills','role','envelope','feedback']);
  const x=resolveResearchAllocation(s,{projectId:input.projectId,trialId:context.trialId,workspaceId:input.workspaceContext?.workspaceId,runOperationId:input.operationId});
  if(!x||input.taskId!==x.task.id||digest(context)!==digest(contextForAllocation(x.allocation))||digest(input.researchContext??null)!==digest(buildResearchContext(s,{projectId:input.projectId,trialId:x.trial.id})))fail('RESEARCH_COMPONENT_CONTEXT','Exact canonical cohort context required',409);
  const {trial:t,composition:c,allocation:a,workspace:w}=x;
  if(t.stopRequested||t.restoreReviewRequired||stopped(s,c)||w.stopRequested||w.restoreReviewRequired||!['dispatching','running'].includes(t.status)||!Number.isSafeInteger(t.deadlineAt)||clock()>=t.deadlineAt||s.runs.find(r=>r.operationId===a.operationId)?.stopRequest)fail('RESEARCH_COMPONENT_STOP','Trial or allocation is stopped, expired or awaiting recovery',409);
  if(digest(researchContextPolicy(s,{projectId:t.projectId,components:t.manifest.components}))!==t.manifest.contextPolicyDigest)fail('RESEARCH_CONTEXT_POLICY','Pinned context policy changed',409);
  const slot=c.slots.find(x=>x.workspaceId===w.id);validateSkills(s,c,slot);
  validateCohortRoute(s,c,clock);
  const decision=s.events.find(e=>e.type==='adaptive.decision'&&e.id===slot.decisionId&&e.projectId===c.projectId);if(!decision||digest(decision)!==slot.decisionDigest)fail('RESEARCH_COMPONENT_DECISION','Pinned Adaptive selection changed',409);validateDecision(s,decision,c.projectId);
  assertNoMixedControllers(s,c.projectId,{taskId:a.taskId});
  return structuredClone(context);
}
export function evidenceFor(s,c,a){
  const run=runFor(s,a);if(!run||!terminal.has(run.status))return null;
  const all=records(s,'evidence',c.projectId).filter(e=>e.trialId===c.trialId&&e.allocationId===a.id);
  const e=all.at(-1);if(!e)return null;intact(e);
  if(e.compositionId!==c.id||e.manifestDigest!==c.manifestDigest||e.runId!==run.id||e.attemptId!==run.attemptId||e.workspaceId!==a.workspaceId||e.independent!==true||!['PASSED','FAILED'].includes(e.status)||!e.checks?.length||!e.checks.some(k=>['artifact','held-out','external-state','deterministic'].includes(k.kind))||e.status==='PASSED'&&!e.checks.every(k=>k.passed===true))fail('RESEARCH_COMPONENT_EVIDENCE','Independent evidence does not match exact run/attempt',409);
  return e;
}
export function newId(){return randomUUID();}
