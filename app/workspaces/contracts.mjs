import path from 'node:path';
import {realpathSync} from 'node:fs';
import {entity, find, fail, changed, revision} from '../server/domain.mjs';
import {digest, boundedText, integer} from '../adaptive/records.mjs';
import {taskSignature, planSignature} from '../goals/contracts.mjs';
export {entity, find, fail, changed, revision, digest, boundedText, integer, taskSignature, planSignature};

export const terminal = new Set(['completed','failed','cancelled','interrupted','rolled_back','stopped']);
export const activeWorkspace = w => ['admitting','running','unknown','stopping'].includes(w.status);
export const records = (s,kind,projectId) => s.events.filter(e=>e.type===`workspace.${kind}`&&(!projectId||e.projectId===projectId));
export function record(s,kind,id,projectId){const r=find(s,'events',id,projectId);if(r.type!==`workspace.${kind}`)fail('NOT_FOUND',`Workspace ${kind} not found`,404);return r;}
export function append(s,kind,data,projectId){const r=entity({type:`workspace.${kind}`,...data},projectId);s.events.push(r);return r;}
export function exact(value,keys,label='input'){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))fail('VALIDATION',`Unexpected ${label} fields`);}
export const canonical = p => {try{return realpathSync(p);}catch{return path.resolve(p);}};
export const pathKey = p => process.platform==='win32'?canonical(p).toLowerCase():canonical(p);
export function overlaps(a,b){a=pathKey(a);b=pathKey(b);return a===b||a.startsWith(b+path.sep)||b.startsWith(a+path.sep);}
export function relatedProjects(s,projectId){const p=find(s,'projects',projectId);return new Set(s.projects.filter(x=>x.workspace&&overlaps(x.workspace,p.workspace)).map(x=>x.id));}
export function policy(s,projectId){return records(s,'policy',projectId).at(-1)??null;}

// Controllers keep their existing authority. Until they have an explicit
// composable checkout contract, an isolated run cannot borrow their context.
export function assertNoMixedControllers(s,projectId,input={}){
  if(['adaptiveContext','assistanceContext','goalContext','relayContext','proactiveContext','conversationId'].some(k=>input[k]!=null))fail('WORKSPACE_CONTROLLER_CONFLICT','This controller has no qualified isolated-workspace composition contract',409);
  const projects=relatedProjects(s,projectId),inactive=new Set(['completed','cancelled','stopped','exhausted']);
  if(s.events.some(e=>projects.has(e.projectId)&&(
    e.type==='goal.claim'&&e.status==='held'||
    e.type==='proactive.occurrence'&&e.held===true||
    ['adaptive.loop','assistance.loop'].includes(e.type)&&!inactive.has(e.status)||
    e.type==='goal.goal'&&!inactive.has(e.status)&&e.taskIds?.includes(input.taskId)
  )))fail('WORKSPACE_CONTROLLER_CONFLICT','Reconcile the existing task strategy or goal checkout first',409);
}
export function approvedTask(s,projectId,taskId){
  const task=find(s,'tasks',taskId,projectId),plan=find(s,'plans',task.planId,projectId);
  if(plan.approved!==true)fail('PLAN_REQUIRED','Review and approve the canonical plan first',409);
  for(const id of task.dependsOn??[])if(find(s,'tasks',id,projectId).status!=='done')fail('DEPENDENCY','Canonical dependencies remain unfinished',409);
  if(task.botId){const b=find(s,'bots',task.botId,projectId);if(b.status==='retired'||b.kind==='helper'&&b.taskId!==task.id)fail('BOT_SCOPE','Assigned bot is unavailable for this task',409);}
  return {task,plan};
}
export function contextFor(w){return {version:1,workspaceId:w.id,projectId:w.projectId,taskId:w.taskId,baseSha:w.baseSha,sourceHeadSha:w.sourceHeadSha,taskRevision:w.taskRevision,planRevision:w.planRevision};}
export function ownedRun(s,w){
  const runs=s.runs.filter(r=>r.operationId===w.runOperationId);
  if(runs.length>1)fail('RUN_SCOPE','Ambiguous workspace attempt',409);
  const r=runs[0];if(!r)return null;
  if(!r.attemptId||r.projectId!==w.projectId||r.taskId!==w.taskId||(r.botId??null)!==w.botId||digest(r.workspaceContext??null)!==digest(contextFor(w))||w.runId&&r.id!==w.runId||w.attemptId&&r.attemptId!==w.attemptId)fail('RUN_SCOPE','Run does not match the exact workspace/task/attempt',409);
  return r;
}
