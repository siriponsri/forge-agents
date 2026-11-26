import {fail} from './domain.mjs';
import {workspaceProjects} from '../goals/contracts.mjs';
import {sessionRoleRunDigest} from './session-roles.mjs';
const terminal=new Set(['completed','failed','cancelled','interrupted','rolled_back','stopped']);
export const activeTaskRun=r=>(!r.kind||!!r.taskId||r.kind==='conversation')&&!terminal.has(r.status);
export const activeNotebookJob=j=>(j.kind==='notebook'||!!j.computeAttempt)&&['queued','submitting','submitted','starting','running','stopping','unknown','interrupted','awaiting-owner'].includes(j.status);
const inactive=new Set(['completed','stopped','exhausted']);
export function assertWorkspaceAvailable(s,projectId,{runId,jobId,adaptiveLoopId,assistanceLoopId,goalClaimId,proactiveOccurrenceId,orchestratorRunId,sessionParentRunId}={}){
  const projects=workspaceProjects(s,projectId),childIds=new Set();
  const parentId=orchestratorRunId??sessionParentRunId;
  if(parentId){const p=s.runs.find(r=>r.id===parentId&&r.projectId===projectId),profile=p?.guardedContext?.profile;
    if(!p||p.status!=='running'||p.stopRequest||p.stopRequested||p.sessionRole?.role!=='orchestrator'||profile?.purpose!=='supervised-orchestrator-v1'||profile.attemptId!==p.attemptId||JSON.stringify(profile.scope?.capabilities)!==JSON.stringify(['session_children','session_prompt'])||p.guardedReceipt?.owner!=='supervised-orchestrator-native-session'||p.guardedProjection?.providerTurn?.status!=='running'||p.guardedProjection.providerTurn.id!==p.nativeProviderTurnId)fail('SESSION_ORCHESTRATOR_SCOPE','Only the exact attested parent without file tools can coordinate this child',409);
    if(sessionParentRunId){
      if(runId!==p.id||!p.sessionContext)fail('SESSION_ORCHESTRATOR_SCOPE','Only the canonical parent may observe its accepted child',409);
      for(const r of s.runs.filter(r=>r.projectId===projectId&&r.kind==='conversation'&&activeTaskRun(r)&&r.sessionRoleContext?.parentRunId===p.id)){
        const x=r.sessionRoleContext,c=s.events.find(e=>e.type==='session-role.prompt'&&e.id===x.commandId&&e.projectId===projectId),m=s.events.find(e=>e.type==='session-role.membership'&&e.id===x.membershipId&&e.projectId===projectId);
        if(x.parentAttemptId!==p.attemptId||x.parentDigest!==sessionRoleRunDigest(p)||!m||m.status!=='approved'||m.restoreReviewRequired||m.parentRunId!==p.id||m.parentAttemptId!==p.attemptId||m.parentDigest!==x.parentDigest||m.revision!==x.membershipRevision||!c||!['dispatching','linked','unknown'].includes(c.status)||c.parentRunId!==p.id||c.membershipId!==m.id||JSON.stringify(c.context)!==JSON.stringify(x)||c.dispatchInput.operationId!==r.operationId||c.dispatchInput.conversationId!==r.conversationId||c.dispatchInput.botId!==r.botId||c.dispatchInput.text!==r.inputText||c.childRunId&&c.childRunId!==r.id||c.childAttemptId&&c.childAttemptId!==r.attemptId)fail('SESSION_ORCHESTRATOR_SCOPE','Child execution must retain its exact canonical prompt approval',409);
        childIds.add(r.id);
      }
      if(childIds.size>1)fail('WORKSPACE_BUSY','Only one writable child may occupy this workspace',409);
    }
  }
  if(s.runs.some(r=>projects.has(r.projectId)&&r.id!==runId&&r.id!==orchestratorRunId&&!childIds.has(r.id)&&activeTaskRun(r))||s.jobs.some(j=>projects.has(j.projectId)&&j.id!==jobId&&activeNotebookJob(j)))fail('WORKSPACE_BUSY','Reconcile or stop the existing task, chat or notebook execution first',409);
  if(s.events.some(e=>projects.has(e.projectId)&&e.type==='goal.claim'&&e.id!==goalClaimId&&e.status==='held'))fail('GOAL_CONTEXT_REQUIRED','A durable goal owns this workspace checkout',409);
  if(s.events.some(e=>projects.has(e.projectId)&&e.type==='proactive.occurrence'&&e.id!==proactiveOccurrenceId&&e.held===true))fail('PROACTIVE_CONTEXT_REQUIRED','A durable proactive claim owns this workspace',409);
  if(s.events.some(e=>projects.has(e.projectId)&&e.type==='workspace.workspace'&&['admitting','running','unknown','stopping'].includes(e.status)))fail('WORKSPACE_CONTEXT_REQUIRED','An isolated workspace attempt owns this source project; reconcile it before ordinary work',409);
  if(s.events.some(e=>projects.has(e.projectId)&&(
    e.type==='adaptive.loop'&&e.id!==adaptiveLoopId&&!inactive.has(e.status)||
    e.type==='assistance.loop'&&e.id!==assistanceLoopId&&!inactive.has(e.status)
  )))fail('STRATEGY_BUSY','Continue or stop the existing task strategy before starting independent work',409);
}
