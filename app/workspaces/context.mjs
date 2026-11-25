import {record,records,find,fail,digest,contextFor,approvedTask,taskSignature,planSignature,assertNoMixedControllers,relatedProjects,policy,terminal,activeWorkspace,pathKey,ownedRun} from './contracts.mjs';
import {inspectWorkspace} from './git.mjs';

// Call inside T3's authoritative reservation and immediately before launch.
// Paths supplied by HTTP/model input are never accepted as checkout authority.
export function validateWorkspaceContext(s,input){
  if(input.workspaceContext===undefined)return null;
  const c=input.workspaceContext;
  if(!c||c.version!==1)fail('WORKSPACE_CONTEXT','Version-1 workspace context required',409);
  const w=record(s,'workspace',c.workspaceId,input.projectId);
  if(digest(c)!==digest(contextFor(w))||input.taskId!==w.taskId||input.operationId!==w.runOperationId||w.stopRequested||w.restoreReviewRequired||!['admitting','running'].includes(w.status))fail('WORKSPACE_CONTEXT','Stale or foreign workspace admission',409);
  assertNoMixedControllers(s,w.projectId,input);
  const {task,plan}=approvedTask(s,w.projectId,w.taskId),r=s.runs.find(r=>r.operationId===input.operationId);
  if(r){ownedRun(s,w);if(r.stopRequest)fail('WORKSPACE_CONTEXT','The owned run has a retained Stop request',409);}
  const taskRevision=r?.approvalSnapshot?.taskRevision===w.taskRevision?w.taskRevision+1:w.taskRevision;
  const project=find(s,'projects',w.projectId);
  if(task.revision!==taskRevision||taskSignature(task)!==w.taskSignature||plan.revision!==w.planRevision||planSignature(plan)!==w.planSignature||(task.botId?find(s,'bots',task.botId,w.projectId).revision:null)!==w.botRevision||digest(project.profile)!==w.profileDigest||pathKey(project.workspace)!==pathKey(w.sourceRoot))fail('REVISION_CONFLICT','Approved work or execution settings changed; create a new workspace',409);
  return structuredClone(c);
}

// The central admission function must invoke this only for a validated context;
// its original path remains authoritative for all ordinary runs/jobs/claims.
export function assertIsolatedWorkspaceAvailable(s,projectId,input={}){
  const c=validateWorkspaceContext(s,{...input,projectId});
  if(!c)fail('WORKSPACE_CONTEXT','Explicit isolated admission context required',409);
  const w=record(s,'workspace',c.workspaceId,projectId),projects=relatedProjects(s,projectId),p=policy(s,projectId);
  if(!p)fail('WORKSPACE_POLICY_REQUIRED','Owner must configure parallel capacity first',409);
  if(s.jobs.some(j=>projects.has(j.projectId)&&!terminal.has(j.status)&&!['ready','saved'].includes(j.status)))fail('WORKSPACE_BUSY','A notebook/job owns the source workspace',409);
  const otherRuns=s.runs.filter(r=>projects.has(r.projectId)&&r.id!==input.runId&&r.operationId!==w.runOperationId&&!terminal.has(r.status));
  for(const r of otherRuns){
    const other=r.workspaceContext&&records(s,'workspace').find(x=>x.id===r.workspaceContext.workspaceId);
    if(!other||other.id===w.id||other.taskId===w.taskId||other.worktreePath===w.worktreePath||digest(r.workspaceContext)!==digest(contextFor(other))||r.operationId!==other.runOperationId)fail('WORKSPACE_BUSY','Another execution lacks distinct authoritative file isolation',409);
  }
  const occupied=records(s,'workspace').filter(x=>projects.has(x.projectId)&&x.id!==w.id&&activeWorkspace(x));
  if(occupied.some(x=>x.taskId===w.taskId))fail('TASK_BUSY','This canonical task already has an owned attempt',409);
  // Both limits are explicit Owner ceilings, not observed available capacity.
  if(occupied.length>=p.maxConcurrent)fail('WORKSPACE_CAPACITY','Configured parallel capacity is occupied',409);
  const provider=find(s,'projects',projectId).profile?.provider;
  const providerRuns=s.runs.filter(r=>r.id!==input.runId&&r.operationId!==w.runOperationId&&!terminal.has(r.status)&&(r.selection?.instanceId??r.providerInstanceId)===provider?.instanceId);
  const pending=records(s,'workspace').filter(x=>x.id!==w.id&&activeWorkspace(x)&&x.providerInstanceId===provider?.instanceId&&!s.runs.some(r=>r.operationId===x.runOperationId));
  if(providerRuns.length+pending.length>=p.providerLimit)fail('PROVIDER_CAPACITY','Configured provider ceiling is occupied',409);
  return c;
}
export async function resolveWorkspaceForRun({store,input,dataDir}){
  const s=store.read(),context=validateWorkspaceContext(s,input);
  if(!context)return null;
  assertIsolatedWorkspaceAvailable(s,input.projectId,{...input,runId:s.runs.find(r=>r.operationId===input.operationId)?.id});
  const w=record(s,'workspace',context.workspaceId,input.projectId);
  const observed=await inspectWorkspace(w,dataDir);
  if(observed.head!==w.baseSha||observed.dirty)fail('WORKSPACE_CHANGED','The reserved checkout changed before dispatch',409);
  return {workspace:observed.path,branch:w.branch,baseSha:w.baseSha,sourceHeadSha:w.sourceHeadSha,workspaceId:w.id,context};
}
export function workspacePrompt(resolved){
  if(!resolved)return '';
  return `\nFORGE isolated workspace ${resolved.workspaceId}. Run commands with this explicit working directory: ${resolved.workspace}. Branch: ${resolved.branch}; immutable base: ${resolved.baseSha}; source snapshot: ${resolved.sourceHeadSha}. Work only in this checkout, preserve other checkouts and branches, commit your task changes here, and report actual checks/evidence. Do not push or merge into the original user branch. A Git worktree separates files; it is not an OS security sandbox. Existing tool permissions, desktop single-controller rules and Owner approvals still apply.`;
}
