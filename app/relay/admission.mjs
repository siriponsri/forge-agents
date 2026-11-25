import { digest, fail, find, relayState, taskDigest } from './common.mjs';

/** Lead MUST call in the normal T3 startRun reservation transaction before effects.
 * No actor or approved boolean can replace this durable same-channel evidence.
 */
export function validateRelayAdmission(s, input) {
  const matching = s.relay?.inbox?.find(x => x.reservation?.operationId === input.operationId);
  if (!input.relayContext) {
    if (matching) fail('RELAY_CONTEXT_REQUIRED');
    // A generic /api/runs/start call with a new operation ID must not bypass
    // originating-channel approval for a task already linked to mobile work.
    if (s.relay?.inbox?.some(x => x.projectId === input.projectId && x.taskId === input.taskId)) fail('RELAY_TASK_CHANNEL_REQUIRED', 'This task requires approval through its mobile Inbox channel');
    return null;
  }
  const c = input.relayContext, r = relayState(s), item = find(r, 'inbox', c.inboxId, input.projectId);
  const binding = find(r, 'bindings', item.bindingId, input.projectId);
  if (!binding.enabled || item.stopRequested || item.status !== 'dispatching' || !item.reservation || item.taskId !== input.taskId || item.reservation.operationId !== input.operationId) fail('RELAY_ADMISSION_DENIED');
  const event = r.events.find(e => e.id === item.approvalEventId && e.inboxId === item.id && e.action === 'approve' && e.bindingId === binding.id);
  const expected = { version: 1, inboxId: item.id, reservationId: item.reservation.id, bindingId: binding.id,
    approvalEventId: item.approvalEventId, taskDigest: item.taskDigest };
  if (!event || digest(c) !== digest(expected) || taskDigest(s, item.projectId, item.taskId) !== item.taskDigest) fail('RELAY_APPROVAL_STALE', 'Approval no longer matches this task');
  return structuredClone(expected);
}

// Final dispatch uses current channel authority. Only the canonical run's own
// known reservation mutation is normalized; edits, Stop and revocation remain
// visible to the original approval digest checker.
export function validateRelayDispatch(s,input,runId){
  if(!input.relayContext)return validateRelayAdmission(s,input);
  const run=find(s,'runs',runId,input.projectId),before=run.approvalSnapshot?.relayTask;
  const task=find(s,'tasks',input.taskId,input.projectId);
  if(!before||run.taskId!==input.taskId||run.operationId!==input.operationId||digest(run.relayContext)!==digest(input.relayContext)||task.revision!==before.revision+1||digest(task.runIds)!==digest([...(before.runIds??[]),run.id]))fail('RELAY_APPROVAL_STALE','Mobile task reservation changed before dispatch');
  const normalized={...task,revision:before.revision,updatedAt:before.updatedAt,runIds:before.runIds};
  if(digest(normalized)!==digest(before))fail('RELAY_APPROVAL_STALE','Approved mobile task changed before dispatch');
  return validateRelayAdmission({...s,tasks:s.tasks.map(t=>t.id===task.id?normalized:t)},input);
}
