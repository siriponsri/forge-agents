import { append, audit, changed, digest, fail, find, human, json, mutate, records, revision, text } from './common.mjs';

const modes = ['allowed', 'ask', 'off'];
function mode(value) { if (!modes.includes(value)) fail('POLICY_MODE', 'Choose allowed, ask or off'); return value; }
function connection(s, input) {
  if (!input || ['projectId', 'connectionId'].some(k => text(input[k], k) !== input[k])) fail('VALIDATION', 'Use exact project and connection identities');
  find(s, 'projects', text(input.projectId, 'projectId'));
  const c = find(s, 'connections', text(input.connectionId, 'connectionId'), input.projectId);
  if (c.kind !== 'mcp') fail('SCOPE', 'Governance tool policy requires an MCP connection', 409);
  return c;
}
export function policyFor(s, input) {
  connection(s, input);
  return records(s, 'policy', input.projectId).find(r => r.connectionId === input.connectionId) ?? { projectId: input.projectId, connectionId: input.connectionId, revision: 0, mode: 'off', tools: {} };
}
function effective(policy, name) {
  // A tool override can narrow the connection policy, never widen it.
  return modes[Math.max(modes.indexOf(policy.mode), modes.indexOf(policy.tools[name] ?? policy.mode))];
}
function target(c) {
  return { id: c.id, projectId: c.projectId, route: c.route ?? null, url: c.url ?? null,
    command: c.command ?? null, args: c.args ?? [], config: c.config ?? {},
    tools: c.lastCheck?.capabilities ?? [] };
}
function policyCurrent(c, policy) { return !!policy.id && policy.targetFingerprint === digest(target(c)); }
function binding(s, input) {
  const c = connection(s, input), policy = policyFor(s, input);
  const tool = c.lastCheck?.capabilities?.find(t => t.name === input.name);
  // A new endpoint/account/tool catalog cannot inherit an old Allowed grant.
  const currentMode = policyCurrent(c, policy) ? effective(policy, input.name) : 'off';
  return {
    policyRevision: policy.revision, connectionRevision: c.revision, mode: currentMode, enabled: c.enabled !== false,
    ready: c.discoveryStale === false && !!tool,
    // Revision fencing also prevents disable/re-enable or change/revert from
    // resurrecting an unconsumed grant. Even a discovery refresh needs review.
    fingerprint: digest({ policyRevision: policy.revision, connectionRevision: c.revision ?? null, mode: currentMode, connection: {
      id: c.id, projectId: c.projectId, enabled: c.enabled !== false, route: c.route ?? null,
      url: c.url ?? null, command: c.command ?? null, args: c.args ?? [], config: c.config ?? {},
    }, tool: tool ?? null }),
  };
}
function operation(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('VALIDATION', 'A concrete tool operation is required');
  const args = json(input.arguments ?? {});
  if (!args || Array.isArray(args) || typeof args !== 'object') fail('MCP_ARGUMENTS', 'Tool arguments must be an object');
  if (JSON.stringify(args).length > 128000) fail('LIMIT', 'Tool arguments exceed 128000 characters');
  for (const key of ['projectId', 'connectionId', 'name', 'operationId']) if (text(input[key], key) !== input[key]) fail('VALIDATION', `${key} cannot have surrounding whitespace`);
  return { projectId: input.projectId, connectionId: input.connectionId,
    name: input.name, arguments: args, toolOperationId: input.operationId };
}
function request(s, input) {
  const op = operation(input), fingerprint = digest(op), current = binding(s, op);
  // Deliberately not events.operationId: MCP owns that dispatch identity.
  const prior = s.events.find(e => e.type === 'governance.tool-approval' && e.toolOperationId === op.toolOperationId);
  if (prior) {
    if (prior.fingerprint !== fingerprint) fail('OPERATION_REUSE', 'Tool operation ID belongs to other arguments or scope', 409);
    if (['pending', 'approved'].includes(prior.status)) {
      const reason = staleReason(s, prior); if (reason) stale(s, prior, reason);
    }
    return prior;
  }
  const reason = !current.enabled ? 'connection_disabled' : current.mode === 'off' ? 'policy_off' : !current.ready ? 'discovery_required' : null;
  const approval = append(s, 'tool-approval', op.projectId, { ...op, fingerprint, binding: current, status: reason ? 'denied' : 'pending', reason });
  audit(s, op.projectId, 'tool.requested', { approvalId: approval.id, status: approval.status, reason });
  return approval;
}
function staleReason(s, approval) {
  let current;
  try { current = binding(s, approval); } catch { return 'scope_missing'; }
  if (!current.enabled) return 'connection_disabled';
  if (current.mode === 'off') return 'policy_off';
  if (!current.ready) return 'discovery_required';
  return current.fingerprint !== approval.binding.fingerprint ? 'configuration_changed' : null;
}
function stale(s, approval, reason) {
  approval.status = 'stale'; approval.reason = reason; changed(approval);
  audit(s, approval.projectId, 'tool.stale', { approvalId: approval.id, reason });
}
export function createPolicyMethods({ store }) {
  return {
    policy(input) {
      const s = store.read(), c = connection(s, input), policy = policyFor(s, input);
      return structuredClone({ ...policy, connectionRevision: c.revision, bindingCurrent: policyCurrent(c, policy),
        effectiveMode: policyCurrent(c, policy) ? policy.mode : 'off' });
    },
    async configurePolicy(input) {
      return mutate(store, 'policy.configure', input, (s, i) => {
        const c = connection(s, i), previous = policyFor(s, i); revision(previous, i.expectedRevision);
        if (i.expectedConnectionRevision !== undefined) revision(c, i.expectedConnectionRevision);
        const actor = human(i.actor), value = mode(i.mode), tools = i.tools ?? {};
        if (!tools || Array.isArray(tools) || typeof tools !== 'object' || Object.keys(tools).length > 500) fail('POLICY_TOOLS', 'Use a bounded tool policy map');
        for (const [name, value] of Object.entries(tools)) { if (text(name, 'tool name') !== name || name === '*') fail('POLICY_TOOLS', 'Use exact concrete tool names'); mode(value); }
        let policy = previous;
        const targetFingerprint = digest(target(c));
        if (!previous.id) policy = append(s, 'policy', i.projectId, { connectionId: c.id, mode: value, tools, targetFingerprint });
        else { Object.assign(policy, { mode: value, tools, targetFingerprint }); changed(policy); }
        for (const a of records(s, 'tool-approval', i.projectId)) if (a.connectionId === c.id && ['pending', 'approved'].includes(a.status)) stale(s, a, 'policy_changed');
        audit(s, i.projectId, 'policy.configured', { connectionId: c.id, policyId: policy.id, policyRevision: policy.revision, actor, mode: value, tools });
        return policy;
      });
    },
    async requestTool(input) {
      // A tool request uses the eventual MCP operation ID; it needs no command
      // receipt and never reserves that ID from MCP's effect owner.
      const op = operation(input);
      return store.transaction(s => request(s, { ...op, operationId: op.toolOperationId }));
    },
    async decideTool(input) {
      return mutate(store, 'tool.decide', input, (s, i) => {
        const a = find(s, 'events', text(i.approvalId, 'approvalId'), i.projectId);
        if (a.type !== 'governance.tool-approval') fail('NOT_FOUND', 'Tool approval not found', 404);
        revision(a, i.expectedRevision); const actor = human(i.actor);
        if (!['approved', 'denied'].includes(i.decision)) fail('VALIDATION', 'Choose approved or denied');
        if (a.status !== 'pending') fail('APPROVAL_RESOLVED', 'Approval is already resolved; create a new concrete operation', 409);
        const reason = staleReason(s, a);
        if (reason) { stale(s, a, reason); return a; }
        Object.assign(a, { status: i.decision, actor, decidedAt: new Date().toISOString(), note: i.note ? text(i.note, 'note', 2000) : null }); changed(a);
        audit(s, i.projectId, 'tool.decided', { approvalId: a.id, decision: a.status, actor });
        return a;
      });
    },
    async authorizeTool(input) {
      const op = operation(input);
      if (input.signal?.aborted) return false;
      return store.transaction(s => {
        if (input.signal?.aborted) return false;
        const a = request(s, { ...op, operationId: op.toolOperationId });
        if (!['pending', 'approved'].includes(a.status)) return false;
        const reason = staleReason(s, a);
        if (reason) { stale(s, a, reason); return false; }
        if (a.status === 'pending' && a.binding.mode !== 'allowed') return false;
        Object.assign(a, { status: 'consumed', consumedAt: new Date().toISOString(), admission: a.status === 'approved' ? 'human' : 'policy' }); changed(a);
        audit(s, op.projectId, 'tool.consumed', { approvalId: a.id, admission: a.admission });
        // A crash after this commit leaves admission consumed, even if no remote
        // effect occurred. Only MCP can reconcile its dispatch/result record.
        return true;
      });
    },
    validateAdmission(input) {
      const op = operation(input), s = store.read();
      if (input.signal?.aborted) return false;
      const a = s.events.find(e => e.type === 'governance.tool-approval' && e.toolOperationId === op.toolOperationId);
      return !!a && a.status === 'consumed' && a.fingerprint === digest(op) && !staleReason(s, a);
    },
    async recover({ invalidateUnconsumed = false } = {}) {
      return store.transaction(s => {
        let count = 0;
        for (const a of s.events.filter(e => e.type === 'governance.tool-approval' && ['pending', 'approved'].includes(e.status))) {
          const reason = invalidateUnconsumed ? 'explicit_restore' : staleReason(s, a); if (reason) { stale(s, a, reason); count++; }
        }
        return { invalidated: count, redispatched: 0 };
      });
    },
  };
}
