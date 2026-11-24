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
