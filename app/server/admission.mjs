import {fail} from './domain.mjs';
import {workspaceProjects} from '../goals/contracts.mjs';
const terminal=new Set(['completed','failed','cancelled','interrupted','rolled_back','stopped']);
export const activeTaskRun=r=>(!r.kind||!!r.taskId||r.kind==='conversation')&&!terminal.has(r.status);
export const activeNotebookJob=j=>(j.kind==='notebook'||!!j.computeAttempt)&&['queued','submitting','submitted','starting','running','stopping','unknown','interrupted','awaiting-owner'].includes(j.status);
const inactive=new Set(['completed','stopped','exhausted']);
export function assertWorkspaceAvailable(s,projectId,{runId,jobId,adaptiveLoopId,assistanceLoopId,goalClaimId,proactiveOccurrenceId}={}){
  const projects=workspaceProjects(s,projectId);
  if(s.runs.some(r=>projects.has(r.projectId)&&r.id!==runId&&activeTaskRun(r))||s.jobs.some(j=>projects.has(j.projectId)&&j.id!==jobId&&activeNotebookJob(j)))fail('WORKSPACE_BUSY','Reconcile or stop the existing task, chat or notebook execution first',409);
  if(s.events.some(e=>projects.has(e.projectId)&&e.type==='goal.claim'&&e.id!==goalClaimId&&e.status==='held'))fail('GOAL_CONTEXT_REQUIRED','A durable goal owns this workspace checkout',409);
  if(s.events.some(e=>projects.has(e.projectId)&&e.type==='proactive.occurrence'&&e.id!==proactiveOccurrenceId&&e.held===true))fail('PROACTIVE_CONTEXT_REQUIRED','A durable proactive claim owns this workspace',409);
  if(s.events.some(e=>projects.has(e.projectId)&&e.type==='workspace.workspace'&&['admitting','running','unknown','stopping'].includes(e.status)))fail('WORKSPACE_CONTEXT_REQUIRED','An isolated workspace attempt owns this source project; reconcile it before ordinary work',409);
  if(s.events.some(e=>projects.has(e.projectId)&&(
    e.type==='adaptive.loop'&&e.id!==adaptiveLoopId&&!inactive.has(e.status)||
    e.type==='assistance.loop'&&e.id!==assistanceLoopId&&!inactive.has(e.status)
  )))fail('STRATEGY_BUSY','Continue or stop the existing task strategy before starting independent work',409);
}
